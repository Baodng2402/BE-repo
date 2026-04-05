import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewMilestoneCode, Role } from '../../common/enums';
import { ERROR_MESSAGES } from '../../common/constants';
import { ClassCheckpoint } from '../../entities/class-checkpoint.entity';
import { Class } from '../../entities/class.entity';
import { GroupReview } from '../../entities/group-review.entity';
import { Semester } from '../../entities/semester.entity';
import { SemesterStatus } from '../../common/enums/semester-status.enum';
import { UpsertClassCheckpointsDto } from './dto/upsert-class-checkpoints.dto';

const CHECKPOINT_DEFAULTS: {
  checkpoint_number: number;
  deadline_week: number;
  milestone_code: ReviewMilestoneCode;
}[] = [
  {
    checkpoint_number: 1,
    deadline_week: 3,
    milestone_code: ReviewMilestoneCode.REVIEW_1,
  },
  {
    checkpoint_number: 2,
    deadline_week: 8,
    milestone_code: ReviewMilestoneCode.REVIEW_2,
  },
  {
    checkpoint_number: 3,
    deadline_week: 10,
    milestone_code: ReviewMilestoneCode.REVIEW_3,
  },
];

const CHECKPOINT_TO_MILESTONE: Record<number, ReviewMilestoneCode> = {
  1: ReviewMilestoneCode.REVIEW_1,
  2: ReviewMilestoneCode.REVIEW_2,
  3: ReviewMilestoneCode.REVIEW_3,
};

@Injectable()
export class ClassCheckpointService {
  constructor(
    @InjectRepository(ClassCheckpoint)
    private readonly checkpointRepo: Repository<ClassCheckpoint>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Semester)
    private readonly semesterRepo: Repository<Semester>,
    @InjectRepository(GroupReview)
    private readonly groupReviewRepo: Repository<GroupReview>,
  ) {}

  async getCheckpoints(classId: string, userId: string, userRole: string) {
    const cls = await this.findClassOrFail(classId);
    this.assertCanManageCheckpoints(cls, userId, userRole);

    const semester = await this.getActiveSemester();
    const checkpoints = await this.ensureCheckpointsExist(classId, semester.id);

    return {
      class_id: classId,
      semester: {
        id: semester.id,
        code: semester.code,
        name: semester.name,
        current_week: semester.current_week,
      },
      checkpoints: checkpoints.map((cp) => ({
        checkpoint_number: cp.checkpoint_number,
        milestone_code: cp.milestone_code,
        deadline_week: cp.deadline_week,
        description: cp.description,
      })),
    };
  }

  async upsertCheckpoints(
    classId: string,
    userId: string,
    userRole: string,
    dto: UpsertClassCheckpointsDto,
  ) {
    const cls = await this.findClassOrFail(classId);
    this.assertCanManageCheckpoints(cls, userId, userRole);

    const semester = await this.getActiveSemester();

    // Validate ascending deadline weeks
    const sorted = [...dto.checkpoints].sort(
      (a, b) => a.checkpoint_number - b.checkpoint_number,
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].deadline_week <= sorted[i - 1].deadline_week) {
        throw new BadRequestException(
          ERROR_MESSAGES.CHECKPOINTS.WEEKS_NOT_ASCENDING,
        );
      }
    }

    // Validate all 3 checkpoint numbers are present
    const numbers = sorted.map((c) => c.checkpoint_number);
    if (
      numbers.length !== 3 ||
      numbers[0] !== 1 ||
      numbers[1] !== 2 ||
      numbers[2] !== 3
    ) {
      throw new BadRequestException(
        ERROR_MESSAGES.CHECKPOINTS.INVALID_CHECKPOINT_NUMBERS,
      );
    }

    // Check if any published grades exist — block deadline changes for those
    for (const item of sorted) {
      const milestoneCode = CHECKPOINT_TO_MILESTONE[item.checkpoint_number];
      const existing = await this.checkpointRepo.findOne({
        where: {
          class_id: classId,
          semester_id: semester.id,
          checkpoint_number: item.checkpoint_number,
        },
      });

      if (existing && existing.deadline_week !== item.deadline_week) {
        const hasPublished = await this.groupReviewRepo
          .createQueryBuilder('gr')
          .innerJoin('gr.group', 'g')
          .where('gr.semester_id = :semesterId', { semesterId: semester.id })
          .andWhere('g.class_id = :classId', { classId })
          .andWhere('gr.milestone_code = :milestoneCode', { milestoneCode })
          .andWhere('gr.is_published = true')
          .getCount();

        if (hasPublished > 0) {
          throw new BadRequestException(
            ERROR_MESSAGES.CHECKPOINTS.PUBLISHED_GRADES_LOCKED,
          );
        }
      }
    }

    // Upsert all 3 checkpoints
    const results: ClassCheckpoint[] = [];
    for (const item of sorted) {
      const milestoneCode = CHECKPOINT_TO_MILESTONE[item.checkpoint_number];

      const existing = await this.checkpointRepo.findOne({
        where: {
          class_id: classId,
          semester_id: semester.id,
          checkpoint_number: item.checkpoint_number,
        },
      });

      if (existing) {
        existing.deadline_week = item.deadline_week;
        existing.description = item.description ?? existing.description;
        existing.milestone_code = milestoneCode;
        results.push(await this.checkpointRepo.save(existing));
      } else {
        results.push(
          await this.checkpointRepo.save(
            this.checkpointRepo.create({
              class_id: classId,
              semester_id: semester.id,
              checkpoint_number: item.checkpoint_number,
              milestone_code: milestoneCode,
              deadline_week: item.deadline_week,
              description: item.description ?? null,
            }),
          ),
        );
      }
    }

    return {
      class_id: classId,
      semester: {
        id: semester.id,
        code: semester.code,
        name: semester.name,
        current_week: semester.current_week,
      },
      checkpoints: results.map((cp) => ({
        checkpoint_number: cp.checkpoint_number,
        milestone_code: cp.milestone_code,
        deadline_week: cp.deadline_week,
        description: cp.description,
      })),
    };
  }

  async ensureCheckpointsExist(
    classId: string,
    semesterId: string,
  ): Promise<ClassCheckpoint[]> {
    const existing = await this.checkpointRepo.find({
      where: { class_id: classId, semester_id: semesterId },
      order: { checkpoint_number: 'ASC' },
    });

    if (existing.length === 3) return existing;

    // Seed defaults for missing checkpoints
    const existingNumbers = new Set(existing.map((c) => c.checkpoint_number));
    for (const def of CHECKPOINT_DEFAULTS) {
      if (!existingNumbers.has(def.checkpoint_number)) {
        existing.push(
          await this.checkpointRepo.save(
            this.checkpointRepo.create({
              class_id: classId,
              semester_id: semesterId,
              checkpoint_number: def.checkpoint_number,
              milestone_code: def.milestone_code,
              deadline_week: def.deadline_week,
              description: null,
            }),
          ),
        );
      }
    }

    return existing.sort((a, b) => a.checkpoint_number - b.checkpoint_number);
  }

  private async findClassOrFail(classId: string): Promise<Class> {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }
    return cls;
  }

  private assertCanManageCheckpoints(
    cls: Class,
    userId: string,
    userRole: string,
  ) {
    if (userRole === (Role.ADMIN as string)) return;
    if (cls.lecturer_id !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.CLASSES.ACCESS_DENIED);
    }
  }

  private async getActiveSemester(): Promise<Semester> {
    const semester = await this.semesterRepo.findOne({
      where: { status: SemesterStatus.ACTIVE },
    });
    if (!semester) {
      throw new NotFoundException(
        ERROR_MESSAGES.CHECKPOINTS.NO_ACTIVE_SEMESTER,
      );
    }
    return semester;
  }
}
