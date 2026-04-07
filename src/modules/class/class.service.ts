import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import { DocumentStatus, Role } from '../../common/enums';
import { ClassMembership } from '../../entities/class-membership.entity';
import { Class } from '../../entities/class.entity';
import { DocumentSubmission } from '../../entities/document-submission.entity';
import { GroupMembership } from '../../entities/group-membership.entity';
import { GroupRepository as GroupRepositoryEntity } from '../../entities/group-repository.entity';
import { Group } from '../../entities/group.entity';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { MailService } from '../mail/mail.service';
import { classEnrollmentEmail } from '../mail/templates/class-enrollment';
import { CreateClassDto } from './dto/create-class.dto';
import { ImportStudentsResponseDto } from './dto/import-students-response.dto';
import { JoinClassDto } from './dto/join-class.dto';
import { StudentRow } from './utils/file-parser.util';

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);

  constructor(
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepo: Repository<ClassMembership>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  async createClass(lecturerId: string, dto: CreateClassDto) {
    this.logger.warn(
      JSON.stringify({
        event: 'legacy_lecturer_class_create_blocked',
        lecturer_id: lecturerId,
        code: dto.code,
      }),
    );
    throw new ForbiddenException(
      'Class creation is Admin-only and must be managed under a semester.',
    );
  }

  async getAllClasses(userId: string, role: string) {
    if (role === 'LECTURER') {
      return this.classRepo.find({ where: { lecturer_id: userId } });
    } else {
      // Return classes the student is enrolled in + available classes? Let's just return all for simplicity or only valid ones.
      return this.classRepo.find();
    }
  }

  async myClasses(userId: string, role: Role) {
    if (role === Role.LECTURER) {
      return this.classRepo.find({
        where: { lecturer_id: userId },
        order: { code: 'ASC' },
      });
    }

    const memberships = await this.classMembershipRepo.find({
      where: { user_id: userId },
      relations: ['class'],
    });

    return memberships
      .map((membership) => membership.class)
      .filter((targetClass): targetClass is Class => !!targetClass);
  }

  async joinClass(studentId: string, classId: string, dto: JoinClassDto) {
    const targetClass = await this.classRepo.findOne({
      where: { id: classId },
    });
    if (!targetClass) {
      throw new NotFoundException('Class not found');
    }

    if (targetClass.enrollment_key !== dto.enrollment_key) {
      throw new BadRequestException('Invalid enrollment key');
    }

    const existing = await this.classMembershipRepo.findOne({
      where: { class_id: classId, user_id: studentId },
    });

    if (existing) {
      throw new BadRequestException('You are already in this class');
    }

    const membership = this.classMembershipRepo.create({
      class_id: classId,
      user_id: studentId,
    });

    await this.classMembershipRepo.save(membership);
    return { message: 'Joined class successfully' };
  }

  async importStudents(
    classId: string,
    rows: StudentRow[],
  ): Promise<ImportStudentsResponseDto> {
    const targetClass = await this.classRepo.findOne({
      where: { id: classId },
      relations: ['lecturer'],
    });
    if (!targetClass) {
      throw new NotFoundException('Class not found');
    }

    const result: ImportStudentsResponseDto = {
      total: rows.length,
      enrolled: 0,
      created: 0,
      already_enrolled: 0,
      warnings: [],
      failed: [],
    };

    if (rows.length < 15) {
      result.warnings.push(
        `Only ${rows.length} students — fewer than 15 expected. Proceeding anyway.`,
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!emailRegex.test(row.email)) {
        result.failed.push({
          row: i + 2, // +2: 1-indexed + header row
          email: row.email,
          reason: 'Invalid email format',
        });
        continue;
      }

      // Find or create user
      let user = await this.userRepo.findOne({
        where: { email: row.email },
      });

      const isNewUser = !user;
      let tempPassword: string | undefined;

      if (!user) {
        tempPassword = randomBytes(4).toString('hex'); // 8-char alphanumeric
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        user = this.userRepo.create({
          email: row.email,
          student_id: row.student_id || null,
          full_name: row.full_name || null,
          password_hash: hashedPassword,
        });
        user = await this.userRepo.save(user);
        result.created++;
      }

      // Check if already enrolled
      const existingMembership = await this.classMembershipRepo.findOne({
        where: { class_id: classId, user_id: user.id },
      });

      if (existingMembership) {
        result.already_enrolled++;
        continue;
      }

      // Enroll
      const membership = this.classMembershipRepo.create({
        class_id: classId,
        user_id: user.id,
      });
      await this.classMembershipRepo.save(membership);
      result.enrolled++;

      // In-app notification (existing users only)
      if (!isNewUser) {
        const notification = this.notifRepo.create({
          user_id: user.id,
          title: `Enrolled in ${targetClass.code}`,
          message: `You have been enrolled in ${targetClass.name}. Enrollment key: ${targetClass.enrollment_key}`,
        });
        await this.notifRepo.save(notification);
      }

      // Queue email (all students)
      const emailContent = classEnrollmentEmail({
        className: targetClass.name,
        classCode: targetClass.code,
        semester: targetClass.semester,
        lecturerName: targetClass.lecturer?.full_name || 'Your Lecturer',
        enrollmentKey: targetClass.enrollment_key,
        tempPassword,
      });
      await this.mailService.queueEmail(
        row.email,
        emailContent.subject,
        emailContent.html,
      );
    }

    this.logger.log(
      `Import complete for class ${classId}: ${result.enrolled} enrolled, ${result.created} created, ${result.already_enrolled} skipped`,
    );

    return result;
  }

  async getClassAnalytics(classId: string, userId: string, userRole: string) {
    // 1. Fetch and verify class
    const targetClass = await this.classRepo.findOne({
      where: { id: classId },
    });
    if (!targetClass) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }

    // 2. Authorization check
    if (userRole === 'LECTURER') {
      if (targetClass.lecturer_id !== userId) {
        throw new ForbiddenException(ERROR_MESSAGES.CLASSES.ACCESS_DENIED);
      }
    } else if (userRole !== 'ADMIN') {
      throw new ForbiddenException(ERROR_MESSAGES.CLASSES.ACCESS_DENIED);
    }

    // 3. Summary: student count
    const totalStudents = await this.classMembershipRepo.count({
      where: { class_id: classId },
    });

    // 4. Summary: group stats
    const groupStats = await this.groupRepo
      .createQueryBuilder('g')
      .select('COUNT(*)', 'total_groups')
      .addSelect('COUNT(g.topic_id)', 'groups_with_topic')
      .addSelect(
        'SUM(CASE WHEN g.github_repo_url IS NOT NULL THEN 1 ELSE 0 END)',
        'groups_with_github',
      )
      .addSelect(
        'SUM(CASE WHEN g.jira_project_key IS NOT NULL THEN 1 ELSE 0 END)',
        'groups_with_jira',
      )
      .where('g.class_id = :classId', { classId })
      .getRawOne();

    const totalGroups = parseInt(groupStats.total_groups, 10) || 0;
    const groupsWithTopic = parseInt(groupStats.groups_with_topic, 10) || 0;

    // 5. Per-group details
    const rawGroups = await this.groupRepo
      .createQueryBuilder('g')
      .leftJoin('g.topic', 't')
      .select([
        'g.id AS id',
        'g.name AS name',
        'g.status AS status',
        't.name AS topic_name',
        'g.github_repo_url AS github_repo_url',
        'g.jira_project_key AS jira_project_key',
      ])
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)')
          .from(GroupMembership, 'gm')
          .where('gm.group_id = g.id')
          .andWhere('gm.left_at IS NULL');
      }, 'member_count')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)')
          .from(GroupRepositoryEntity, 'gr')
          .where('gr.group_id = g.id');
      }, 'linked_repos_count')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)')
          .from(DocumentSubmission, 'ds')
          .where('ds.group_id = g.id');
      }, 'submission_count')
      .addSelect((subQuery) => {
        return subQuery
          .select('AVG(ds2.score)')
          .from(DocumentSubmission, 'ds2')
          .where('ds2.group_id = g.id')
          .andWhere('ds2.status = :gradedStatus')
          .andWhere('ds2.score IS NOT NULL');
      }, 'graded_avg_score')
      .where('g.class_id = :classId', { classId })
      .setParameter('gradedStatus', DocumentStatus.GRADED)
      .orderBy('g.name', 'ASC')
      .getRawMany();

    // 6. Map raw results to response shape
    const groups = rawGroups.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      topic_name: row.topic_name || null,
      member_count: parseInt(row.member_count, 10) || 0,
      linked_repos_count: parseInt(row.linked_repos_count, 10) || 0,
      submission_count: parseInt(row.submission_count, 10) || 0,
      graded_avg_score: row.graded_avg_score
        ? Math.round(parseFloat(row.graded_avg_score) * 100) / 100
        : null,
      has_github: !!row.github_repo_url,
      has_jira: !!row.jira_project_key,
    }));

    return {
      class_id: targetClass.id,
      class_name: targetClass.name,
      class_code: targetClass.code,
      semester: targetClass.semester || null,
      summary: {
        total_students: totalStudents,
        total_groups: totalGroups,
        groups_with_topic: groupsWithTopic,
        groups_without_topic: totalGroups - groupsWithTopic,
        groups_with_github: parseInt(groupStats.groups_with_github, 10) || 0,
        groups_with_jira: parseInt(groupStats.groups_with_jira, 10) || 0,
      },
      groups,
    };
  }
}
