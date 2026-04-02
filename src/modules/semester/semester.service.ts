import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';
import {
  AuthProvider,
  ReviewMilestoneCode,
  Role,
  SemesterStatus,
  TaskStatus,
} from '../../common/enums';
import {
  Class,
  ClassMembership,
  ExaminerAssignment,
  Group,
  GroupMembership,
  GroupRepository,
  GroupReview,
  ImportBatch,
  ImportRowLog,
  Semester,
  SemesterWeekAuditLog,
  Task,
  TeachingAssignment,
  User,
} from '../../entities';
import { GithubService } from '../github/github.service';
import { BulkExaminerAssignmentDto } from './dto/bulk-examiner-assignment.dto';
import { BulkTeachingAssignmentDto } from './dto/bulk-teaching-assignment.dto';
import { CreateSemesterClassDto } from './dto/create-semester-class.dto';
import { CreateSemesterLecturerDto } from './dto/create-semester-lecturer.dto';
import { CreateSemesterStudentDto } from './dto/create-semester-student.dto';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterClassDto } from './dto/update-semester-class.dto';
import { UpdateSemesterLecturerDto } from './dto/update-semester-lecturer.dto';
import { UpdateSemesterStudentDto } from './dto/update-semester-student.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import { UpsertGroupReviewDto } from './dto/upsert-group-review.dto';
import { SemesterImportRow } from './utils/semester-import.util';

type ImportMode = 'VALIDATE' | 'IMPORT';
type WeekGateStatus = 'PASS' | 'FAIL';
type ReviewMilestoneStatus = 'PENDING' | 'REVIEWED';
type RosterErrorCode =
  | 'CLASS_NOT_IN_SEMESTER'
  | 'CLASS_ALREADY_EXISTS'
  | 'CLASS_NOT_FOUND'
  | 'CLASS_DELETE_CONFLICT'
  | 'SEMESTER_NOT_EDITABLE'
  | 'LECTURER_ALREADY_EXISTS'
  | 'LECTURER_NOT_FOUND'
  | 'LECTURER_STILL_ASSIGNED'
  | 'STUDENT_ALREADY_IN_SEMESTER'
  | 'STUDENT_NOT_FOUND'
  | 'USER_ROLE_CONFLICT'
  | 'WEEK_GATE_NOT_REACHED'
  | 'EXAMINER_OWN_CLASS_CONFLICT';

export interface ReviewMilestoneContext {
  code: ReviewMilestoneCode;
  label: string;
  week_start: number;
  week_end: number;
}

export interface SerializedSemester {
  id: string;
  code: string;
  name: string;
  status: SemesterStatus;
  current_week: number;
  start_date: string;
  end_date: string;
}

@Injectable()
export class SemesterService {
  private readonly logger = new Logger(SemesterService.name);
  private readonly defaultSemesterClassCodes = [
    'SWP391-1001',
    'SWP391-1002',
    'SWP391-1003',
  ] as const;
  private readonly seedLecturerEmail = 'system.seed.lecturer@swp391.local';

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Semester)
    private readonly semesterRepository: Repository<Semester>,
    @InjectRepository(ImportBatch)
    private readonly importBatchRepository: Repository<ImportBatch>,
    @InjectRepository(ImportRowLog)
    private readonly importRowLogRepository: Repository<ImportRowLog>,
    @InjectRepository(Class)
    private readonly classRepository: Repository<Class>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepository: Repository<ClassMembership>,
    @InjectRepository(TeachingAssignment)
    private readonly teachingAssignmentRepository: Repository<TeachingAssignment>,
    @InjectRepository(ExaminerAssignment)
    private readonly examinerAssignmentRepository: Repository<ExaminerAssignment>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMembership)
    private readonly groupMembershipRepository: Repository<GroupMembership>,
    @InjectRepository(GroupRepository)
    private readonly groupRepositoryLinkRepository: Repository<GroupRepository>,
    @InjectRepository(GroupReview)
    private readonly groupReviewRepository: Repository<GroupReview>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(SemesterWeekAuditLog)
    private readonly semesterWeekAuditLogRepository: Repository<SemesterWeekAuditLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly githubService: GithubService,
  ) {}

  async createSemester(dto: CreateSemesterDto) {
    const existing = await this.semesterRepository.findOne({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      throw new ConflictException('Semester code already exists.');
    }

    const semester = this.semesterRepository.create({
      ...dto,
      code: dto.code.toUpperCase(),
      status: dto.status || SemesterStatus.UPCOMING,
    });

    const savedSemester = await this.semesterRepository.save(semester);
    await this.seedDefaultClassesForSemester(savedSemester.code);
    return savedSemester;
  }

  async listSemesters() {
    return this.semesterRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async listPublicSemesters() {
    return this.semesterRepository.find({
      order: { start_date: 'DESC' },
    });
  }

  async getCurrentSemester() {
    const activeSemester = await this.semesterRepository.findOne({
      where: { status: SemesterStatus.ACTIVE },
      order: { start_date: 'DESC' },
    });

    if (activeSemester) {
      return activeSemester;
    }

    const upcomingSemester = await this.semesterRepository.findOne({
      where: { status: SemesterStatus.UPCOMING },
      order: { start_date: 'ASC' },
    });

    if (upcomingSemester) {
      return upcomingSemester;
    }

    return this.semesterRepository.findOne({
      order: { start_date: 'DESC' },
    });
  }

  async getCurrentWeek() {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      return null;
    }

    return {
      semester: this.serializeSemester(semester),
      can_override_week: false,
    };
  }

  async getCurrentReviewMilestone() {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      return {
        semester: null,
        milestone: null,
      };
    }

    return {
      semester: this.serializeSemester(semester),
      milestone: this.resolveReviewMilestone(semester.current_week),
    };
  }

  async setCurrentWeek(
    semesterId: string,
    currentWeek: number,
    actorUserId: string,
    actorRole: Role,
  ) {
    this.assertWeekOverrideAllowed(actorRole);

    const semester = await this.getSemesterOrThrow(semesterId);

    if (semester.current_week === currentWeek) {
      return {
        semester: this.serializeSemester(semester),
        audit_recorded: false,
      };
    }

    const previousWeek = semester.current_week;
    semester.current_week = currentWeek;
    const savedSemester = await this.semesterRepository.save(semester);

    await this.semesterWeekAuditLogRepository.save(
      this.semesterWeekAuditLogRepository.create({
        semester_id: semester.id,
        actor_user_id: actorUserId,
        previous_week: previousWeek,
        new_week: currentWeek,
        trigger_source: 'DEMO_OVERRIDE',
      }),
    );

    this.logger.log(
      JSON.stringify({
        event: 'semester_week_changed',
        semester_id: semester.id,
        semester_code: semester.code,
        actor_user_id: actorUserId,
        actor_role: actorRole,
        previous_week: previousWeek,
        new_week: currentWeek,
        trigger_source: 'DEMO_OVERRIDE',
      }),
    );

    return {
      semester: this.serializeSemester(savedSemester),
      audit_recorded: true,
    };
  }

  async getLecturerComplianceSummary(
    userId: string,
    userRole: Role,
    classId?: string,
  ) {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      return {
        semester: null,
        checkpoints: {
          week1_active: false,
          week2_active: false,
        },
        summary: {
          classes_total: 0,
          classes_passing_week1: 0,
          classes_passing_week2: 0,
          students_without_group_total: 0,
          groups_without_topic_total: 0,
        },
        classes: [],
      };
    }

    const classWhere =
      userRole === Role.ADMIN
        ? { semester: semester.code }
        : { semester: semester.code, lecturer_id: userId };

    const classes = await this.classRepository.find({
      where: classWhere,
      order: { code: 'ASC' },
    });

    const visibleClasses = classId
      ? classes.filter((targetClass) => targetClass.id === classId)
      : classes;

    if (classId && visibleClasses.length === 0) {
      throw new NotFoundException('Class not found for current semester.');
    }

    const classIds = visibleClasses.map((targetClass) => targetClass.id);

    if (classIds.length === 0) {
      return {
        semester: this.serializeSemester(semester),
        checkpoints: {
          week1_active: semester.current_week >= 1,
          week2_active: semester.current_week >= 2,
        },
        summary: {
          classes_total: 0,
          classes_passing_week1: 0,
          classes_passing_week2: 0,
          students_without_group_total: 0,
          groups_without_topic_total: 0,
        },
        classes: [],
      };
    }

    const [classMemberships, groups] = await Promise.all([
      this.classMembershipRepository.find({
        where: { class_id: In(classIds) },
      }),
      this.groupRepository.find({
        where: { class_id: In(classIds) },
        relations: ['topic'],
        order: { created_at: 'ASC' },
      }),
    ]);

    const groupIds = groups.map((group) => group.id);
    const groupMemberships =
      groupIds.length > 0
        ? await this.groupMembershipRepository.find({
            where: {
              group_id: In(groupIds),
              left_at: IsNull(),
            },
          })
        : [];

    const groupsByClassId = new Map<string, Group[]>();
    for (const group of groups) {
      const current = groupsByClassId.get(group.class_id) || [];
      current.push(group);
      groupsByClassId.set(group.class_id, current);
    }

    const classMembershipsByClassId = new Map<string, ClassMembership[]>();
    for (const membership of classMemberships) {
      const current = classMembershipsByClassId.get(membership.class_id) || [];
      current.push(membership);
      classMembershipsByClassId.set(membership.class_id, current);
    }

    const activeMembersByGroupId = new Map<string, GroupMembership[]>();
    for (const membership of groupMemberships) {
      const current = activeMembersByGroupId.get(membership.group_id) || [];
      current.push(membership);
      activeMembersByGroupId.set(membership.group_id, current);
    }

    const classSummaries = visibleClasses.map((targetClass) => {
      const targetGroups = groupsByClassId.get(targetClass.id) || [];
      const targetClassMemberships =
        classMembershipsByClassId.get(targetClass.id) || [];
      const assignedStudentIds = new Set<string>();

      const groupSummaries = targetGroups.map((group) => {
        const activeMembers = activeMembersByGroupId.get(group.id) || [];
        for (const membership of activeMembers) {
          assignedStudentIds.add(membership.user_id);
        }

        const hasTopic = this.isTopicFinalized(group);
        return {
          group_id: group.id,
          group_name: group.name,
          member_count: activeMembers.length,
          max_members: targetClass.max_students_per_group,
          topic_name: group.topic?.name || group.project_name || null,
          has_finalized_topic: hasTopic,
          week1_status: (activeMembers.length > 0
            ? 'PASS'
            : 'FAIL') as WeekGateStatus,
          week2_status: (hasTopic ? 'PASS' : 'FAIL') as WeekGateStatus,
        };
      });

      const totalStudents = targetClassMemberships.length;
      const studentsWithoutGroupCount = targetClassMemberships.filter(
        (membership) => !assignedStudentIds.has(membership.user_id),
      ).length;
      const groupsWithoutTopicCount = groupSummaries.filter(
        (group) => !group.has_finalized_topic,
      ).length;

      return {
        class_id: targetClass.id,
        class_code: targetClass.code,
        class_name: targetClass.name,
        semester: targetClass.semester,
        total_students: totalStudents,
        total_groups: targetGroups.length,
        students_without_group_count: studentsWithoutGroupCount,
        groups_without_topic_count: groupsWithoutTopicCount,
        week1_status: (studentsWithoutGroupCount === 0
          ? 'PASS'
          : 'FAIL') as WeekGateStatus,
        week2_status: (groupsWithoutTopicCount === 0
          ? 'PASS'
          : 'FAIL') as WeekGateStatus,
        groups: groupSummaries,
      };
    });

    return {
      semester: this.serializeSemester(semester),
      checkpoints: {
        week1_active: semester.current_week >= 1,
        week2_active: semester.current_week >= 2,
      },
      summary: {
        classes_total: classSummaries.length,
        classes_passing_week1: classSummaries.filter(
          (item) => item.week1_status === 'PASS',
        ).length,
        classes_passing_week2: classSummaries.filter(
          (item) => item.week2_status === 'PASS',
        ).length,
        students_without_group_total: classSummaries.reduce(
          (sum, item) => sum + item.students_without_group_count,
          0,
        ),
        groups_without_topic_total: classSummaries.reduce(
          (sum, item) => sum + item.groups_without_topic_count,
          0,
        ),
      },
      classes: classSummaries,
    };
  }

  async getStudentWeeklyWarnings(
    userId: string,
    userRole: Role = Role.STUDENT,
  ) {
    try {
      const semester = await this.getCurrentSemester();

      if (!semester) {
        return {
          semester: null,
          warnings: [],
          classes: [],
        };
      }

      const classMemberships = await this.classMembershipRepository.find({
        where: { user_id: userId },
        relations: ['class'],
      });

      const currentClasses = classMemberships
        .map((membership) => membership.class)
        .filter((targetClass): targetClass is Class => {
          return !!targetClass && targetClass.semester === semester.code;
        });

      const classIds = currentClasses.map((targetClass) => targetClass.id);
      const groupMemberships =
        classIds.length > 0
          ? await this.groupMembershipRepository.find({
              where: {
                user_id: userId,
                left_at: IsNull(),
              },
              relations: ['group', 'group.topic', 'group.class'],
            })
          : [];

      const currentGroupMemberships = groupMemberships.filter((membership) => {
        const group = membership.group;
        return (
          !!group &&
          !!group.class &&
          group.class.semester === semester.code &&
          classIds.includes(group.class_id)
        );
      });

      const orphanClassMembershipCount =
        classMemberships.length - currentClasses.length;
      const orphanGroupMembershipCount =
        groupMemberships.length - currentGroupMemberships.length;

      const groupMembershipsByClassId = new Map<string, GroupMembership[]>();
      for (const membership of currentGroupMemberships) {
        const classKey = membership.group?.class_id;
        if (!classKey) {
          continue;
        }
        const current = groupMembershipsByClassId.get(classKey) || [];
        current.push(membership);
        groupMembershipsByClassId.set(classKey, current);
      }

      const warnings: Array<{
        code: string;
        severity: 'warning';
        class_id: string;
        class_code: string;
        class_name: string;
        group_id?: string;
        group_name?: string;
        message: string;
      }> = [];

      const classSummaries = currentClasses.map((targetClass) => {
        const membershipsInClass =
          groupMembershipsByClassId.get(targetClass.id) || [];
        const groups = membershipsInClass
          .map((membership) => membership.group)
          .filter((group): group is Group => !!group);

        if (semester.current_week >= 1 && groups.length === 0) {
          warnings.push({
            code: 'WEEK1_NO_GROUP',
            severity: 'warning',
            class_id: targetClass.id,
            class_code: targetClass.code,
            class_name: targetClass.name,
            message:
              'Week 1 checkpoint is active and you have not joined a group for this class.',
          });
        }

        if (semester.current_week >= 2) {
          for (const group of groups) {
            if (!this.isTopicFinalized(group)) {
              warnings.push({
                code: 'WEEK2_TOPIC_NOT_FINALIZED',
                severity: 'warning',
                class_id: targetClass.id,
                class_code: targetClass.code,
                class_name: targetClass.name,
                group_id: group.id,
                group_name: group.name,
                message:
                  'Week 2 checkpoint is active and your group has not finalized a topic yet.',
              });
            }
          }
        }

        return {
          class_id: targetClass.id,
          class_code: targetClass.code,
          class_name: targetClass.name,
          has_group: groups.length > 0,
          week1_status: (groups.length > 0 ? 'PASS' : 'FAIL') as WeekGateStatus,
          groups: groups.map((group) => ({
            group_id: group.id,
            group_name: group.name,
            topic_name: group.topic?.name || group.project_name || null,
            has_finalized_topic: this.isTopicFinalized(group),
            week2_status: (this.isTopicFinalized(group)
              ? 'PASS'
              : 'FAIL') as WeekGateStatus,
          })),
        };
      });

      this.logger.log(
        JSON.stringify({
          event: 'student_warning_summary',
          user_id: userId,
          role: userRole,
          semester_code: semester.code,
          class_membership_count: classMemberships.length,
          current_class_count: currentClasses.length,
          group_membership_count: groupMemberships.length,
          current_group_membership_count: currentGroupMemberships.length,
          orphan_class_membership_count: orphanClassMembershipCount,
          orphan_group_membership_count: orphanGroupMembershipCount,
          warning_count: warnings.length,
        }),
      );

      return {
        semester: this.serializeSemester(semester),
        warnings,
        classes: classSummaries,
      };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'student_warning_degraded',
          user_id: userId,
          role: userRole,
          message:
            error instanceof Error
              ? error.message
              : 'Unexpected student warning failure.',
        }),
      );

      return {
        semester: null,
        warnings: [],
        classes: [],
      };
    }
  }

  async getLecturerReviewSummary(
    userId: string,
    userRole: Role,
    classId?: string,
  ) {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      return {
        semester: null,
        milestone: null,
        summary: {
          classes_total: 0,
          groups_total: 0,
          reviewed_groups: 0,
          groups_missing_task_evidence: 0,
          groups_missing_commit_evidence: 0,
        },
        classes: [],
      };
    }

    const milestone = this.resolveReviewMilestone(semester.current_week);
    const classWhere =
      userRole === Role.ADMIN
        ? { semester: semester.code }
        : { semester: semester.code, lecturer_id: userId };

    const classes = await this.classRepository.find({
      where: classWhere,
      order: { code: 'ASC' },
    });

    const visibleClasses = classId
      ? classes.filter((targetClass) => targetClass.id === classId)
      : classes;

    if (classId && visibleClasses.length === 0) {
      throw new NotFoundException('Class not found for current semester.');
    }

    const groups =
      visibleClasses.length > 0
        ? await this.groupRepository.find({
            where: {
              class_id: In(visibleClasses.map((targetClass) => targetClass.id)),
            },
            relations: ['topic'],
            order: { created_at: 'ASC' },
          })
        : [];

    const reviewMap = await this.getReviewMapForGroups(
      semester.id,
      milestone,
      groups.map((group) => group.id),
    );

    const classSummaries = visibleClasses.map((targetClass) => ({
      class_id: targetClass.id,
      class_code: targetClass.code,
      class_name: targetClass.name,
      groups: groups
        .filter((group) => group.class_id === targetClass.id)
        .map((group) =>
          this.serializeReviewGroup(group, reviewMap.get(group.id), milestone),
        ),
    }));

    return {
      semester: this.serializeSemester(semester),
      milestone,
      summary: {
        classes_total: classSummaries.length,
        groups_total: classSummaries.reduce(
          (sum, item) => sum + item.groups.length,
          0,
        ),
        reviewed_groups: classSummaries.reduce(
          (sum, item) =>
            sum +
            item.groups.filter((group) => group.review_status === 'REVIEWED')
              .length,
          0,
        ),
        groups_missing_task_evidence: classSummaries.reduce(
          (sum, item) =>
            sum +
            item.groups.filter((group) =>
              group.warnings.includes('NO_TASK_EVIDENCE'),
            ).length,
          0,
        ),
        groups_missing_commit_evidence: classSummaries.reduce(
          (sum, item) =>
            sum +
            item.groups.filter((group) =>
              group.warnings.includes('NO_COMMIT_EVIDENCE'),
            ).length,
          0,
        ),
      },
      classes: classSummaries,
    };
  }

  async upsertCurrentGroupReview(
    groupId: string,
    userId: string,
    userRole: Role,
    dto: UpsertGroupReviewDto,
  ) {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      throw new NotFoundException('No current semester is configured.');
    }

    const milestone = this.resolveReviewMilestone(semester.current_week);
    if (!milestone) {
      throw new BadRequestException(
        'No active review milestone is available for the current week.',
      );
    }

    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['class', 'topic'],
    });

    if (!group) {
      throw new NotFoundException('Group not found.');
    }

    if (
      userRole !== Role.ADMIN &&
      (!group.class || group.class.lecturer_id !== userId)
    ) {
      throw new ForbiddenException(
        'You are not allowed to update review data for this group.',
      );
    }

    const snapshot = await this.captureReviewSnapshot(group);
    const existingReview = await this.groupReviewRepository.findOne({
      where: {
        semester_id: semester.id,
        group_id: group.id,
        milestone_code: milestone.code,
      },
    });

    const review = this.groupReviewRepository.create({
      id: existingReview?.id,
      semester_id: semester.id,
      group_id: group.id,
      milestone_code: milestone.code,
      week_start: milestone.week_start,
      week_end: milestone.week_end,
      task_progress_score:
        dto.task_progress_score ?? existingReview?.task_progress_score ?? null,
      commit_contribution_score:
        dto.commit_contribution_score ??
        existingReview?.commit_contribution_score ??
        null,
      review_milestone_score:
        dto.review_milestone_score ??
        existingReview?.review_milestone_score ??
        null,
      lecturer_note: dto.lecturer_note ?? existingReview?.lecturer_note ?? null,
      snapshot_task_total: snapshot.task_total,
      snapshot_task_done: snapshot.task_done,
      snapshot_commit_total: snapshot.commit_total,
      snapshot_commit_contributors: snapshot.commit_contributors,
      snapshot_repository: snapshot.repository,
      snapshot_captured_at: snapshot.captured_at,
      updated_by_id: userId,
    });

    const savedReview = await this.groupReviewRepository.save(review);

    this.logger.log(
      JSON.stringify({
        event: 'group_review_upserted',
        semester_id: semester.id,
        group_id: group.id,
        milestone_code: milestone.code,
        actor_user_id: userId,
      }),
    );

    return {
      semester: this.serializeSemester(semester),
      milestone,
      group: this.serializeReviewGroup(group, savedReview, milestone),
    };
  }

  async getStudentReviewStatus(userId: string) {
    const semester = await this.getCurrentSemester();

    if (!semester) {
      return {
        semester: null,
        milestone: null,
        groups: [],
      };
    }

    const milestone = this.resolveReviewMilestone(semester.current_week);
    const groupMemberships = await this.groupMembershipRepository.find({
      where: {
        user_id: userId,
        left_at: IsNull(),
      },
      relations: ['group', 'group.class', 'group.topic'],
    });

    const currentGroups = groupMemberships
      .map((membership) => membership.group)
      .filter(
        (group): group is Group & { class: Class } =>
          !!group && !!group.class && group.class.semester === semester.code,
      );

    const reviewMap = await this.getReviewMapForGroups(
      semester.id,
      milestone,
      currentGroups.map((group) => group.id),
    );

    return {
      semester: this.serializeSemester(semester),
      milestone,
      groups: currentGroups.map((group) => ({
        class_id: group.class_id,
        class_code: group.class.code,
        class_name: group.class.name,
        ...this.serializeReviewGroup(
          group,
          reviewMap.get(group.id),
          milestone,
          true,
        ),
      })),
    };
  }

  async publishMilestoneReviews(
    milestoneCode: ReviewMilestoneCode,
    userId: string,
    userRole: Role,
    classId?: string,
  ): Promise<{ updated_count: number }> {
    const semester = await this.getCurrentSemester();
    if (!semester) {
      throw new NotFoundException('No active semester found.');
    }

    // Build query for matching reviews
    const qb = this.groupReviewRepository
      .createQueryBuilder('review')
      .innerJoin('review.group', 'grp')
      .innerJoin(Class, 'cls', 'cls.id = grp.class_id')
      .where('review.semester_id = :semesterId', { semesterId: semester.id })
      .andWhere('review.milestone_code = :milestoneCode', { milestoneCode })
      .andWhere('review.is_published = :isPublished', { isPublished: false });

    // Scope to lecturer's classes unless admin
    if (userRole !== Role.ADMIN) {
      if (classId) {
        qb.andWhere('cls.id = :classId AND cls.lecturer_id = :lecturerId', {
          classId,
          lecturerId: userId,
        });
      } else {
        qb.andWhere('cls.lecturer_id = :lecturerId', {
          lecturerId: userId,
        });
      }
    } else if (classId) {
      qb.andWhere('cls.id = :classId', { classId });
    }

    const reviews = await qb.getMany();

    if (reviews.length === 0) {
      return { updated_count: 0 };
    }

    await this.groupReviewRepository.update(
      reviews.map((r) => r.id),
      { is_published: true },
    );

    return { updated_count: reviews.length };
  }

  async getStudentPublishedScores(userId: string) {
    const semester = await this.getCurrentSemester();
    if (!semester) {
      return { semester: null, milestones: [] };
    }

    // Get student's current groups in this semester
    const groupMemberships = await this.groupMembershipRepository.find({
      where: { user_id: userId, left_at: IsNull() },
      relations: ['group', 'group.class', 'group.topic'],
    });

    const currentGroups = groupMemberships
      .map((m) => m.group)
      .filter(
        (g): g is Group & { class: Class } =>
          !!g && !!g.class && g.class.semester === semester.code,
      );

    if (currentGroups.length === 0) {
      return { semester: this.serializeSemester(semester), milestones: [] };
    }

    // Get ALL published reviews for these groups
    const publishedReviews = await this.groupReviewRepository.find({
      where: {
        semester_id: semester.id,
        group_id: In(currentGroups.map((g) => g.id)),
        is_published: true,
      },
      order: { week_start: 'ASC' },
    });

    // Group by milestone
    const milestoneMap = new Map<
      string,
      { milestone: ReviewMilestoneContext; groups: any[] }
    >();

    for (const review of publishedReviews) {
      const key = review.milestone_code;
      if (!milestoneMap.has(key)) {
        milestoneMap.set(key, {
          milestone: {
            code: review.milestone_code,
            label: this.getMilestoneLabel(review.milestone_code),
            week_start: review.week_start,
            week_end: review.week_end,
          },
          groups: [],
        });
      }

      const group = currentGroups.find((g) => g.id === review.group_id);
      if (group) {
        const totalScore =
          (Number(review.task_progress_score ?? 0) || 0) +
          (Number(review.commit_contribution_score ?? 0) || 0) +
          (Number(review.review_milestone_score ?? 0) || 0);

        milestoneMap.get(key)!.groups.push({
          group_id: group.id,
          group_name: group.name,
          topic_name: group.topic?.name || group.project_name || null,
          scores: {
            task_progress_score: review.task_progress_score,
            commit_contribution_score: review.commit_contribution_score,
            review_milestone_score: review.review_milestone_score,
            total_score: Number(totalScore.toFixed(2)),
          },
          lecturer_note: review.lecturer_note,
        });
      }
    }

    return {
      semester: this.serializeSemester(semester),
      milestones: Array.from(milestoneMap.values()),
    };
  }

  private getMilestoneLabel(code: ReviewMilestoneCode): string {
    const labels: Record<string, string> = {
      REVIEW_1: 'Review 1',
      PROGRESS_TRACKING: 'Progress Tracking',
      REVIEW_2: 'Review 2',
      REVIEW_3: 'Review 3',
      FINAL_PRESENTATION: 'Final Presentation',
    };
    return labels[code] || code;
  }

  async updateSemester(id: string, dto: UpdateSemesterDto) {
    const semester = await this.getSemesterOrThrow(id);

    if (dto.code && dto.code.toUpperCase() !== semester.code) {
      const existing = await this.semesterRepository.findOne({
        where: { code: dto.code.toUpperCase() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Semester code already exists.');
      }
    }

    Object.assign(semester, {
      ...dto,
      code: dto.code ? dto.code.toUpperCase() : semester.code,
    });

    return this.semesterRepository.save(semester);
  }

  async getSemesterRoster(semesterId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    const classes = await this.classRepository.find({
      where: { semester: semester.code },
      relations: ['lecturer'],
      order: { code: 'ASC' },
    });
    const classIds = classes.map((item) => item.id);

    const [
      teachingAssignments,
      examinerAssignments,
      studentMemberships,
      lecturers,
    ] = await Promise.all([
      this.teachingAssignmentRepository.find({
        where: { semester_id: semester.id },
        relations: ['class', 'lecturer'],
      }),
      this.examinerAssignmentRepository.find({
        where: { semester_id: semester.id },
        relations: ['class', 'lecturer'],
      }),
      classIds.length === 0
        ? Promise.resolve([])
        : this.classMembershipRepository.find({
            where: { class_id: In(classIds) },
            relations: ['class', 'user'],
          }),
      this.userRepository.find({
        where: { role: Role.LECTURER },
        order: { full_name: 'ASC', email: 'ASC' },
      }),
    ]);

    const teachingByClassId = new Map(
      teachingAssignments.map((assignment) => [
        assignment.class_id,
        assignment,
      ]),
    );
    const examinerByClassId = new Map<string, ExaminerAssignment[]>();
    for (const assignment of examinerAssignments) {
      const bucket = examinerByClassId.get(assignment.class_id) || [];
      bucket.push(assignment);
      examinerByClassId.set(assignment.class_id, bucket);
    }

    const studentMembershipsByClassId = new Map<string, ClassMembership[]>();
    for (const membership of studentMemberships) {
      const bucket = studentMembershipsByClassId.get(membership.class_id) || [];
      bucket.push(membership);
      studentMembershipsByClassId.set(membership.class_id, bucket);
    }

    const classRows = classes.map((classItem) => {
      const teachingAssignment = teachingByClassId.get(classItem.id);
      const classExaminers = examinerByClassId.get(classItem.id) || [];
      return {
        ...this.buildSemesterClassRow(
          classItem,
          teachingAssignment,
          classExaminers,
        ),
        student_count: (studentMembershipsByClassId.get(classItem.id) || [])
          .length,
      };
    });

    const teachingByLecturerId = new Map<string, typeof classRows>();
    for (const classRow of classRows) {
      if (!classRow.lecturer_id) continue;
      const bucket = teachingByLecturerId.get(classRow.lecturer_id) || [];
      bucket.push(classRow);
      teachingByLecturerId.set(classRow.lecturer_id, bucket);
    }

    const examinerByLecturerId = new Map<
      string,
      Array<{ class_id: string; class_code: string; class_name: string }>
    >();
    for (const [classId, assignments] of examinerByClassId.entries()) {
      const targetClass = classes.find((item) => item.id === classId);
      if (!targetClass) continue;
      for (const assignment of assignments) {
        const bucket = examinerByLecturerId.get(assignment.lecturer_id) || [];
        bucket.push({
          class_id: targetClass.id,
          class_code: targetClass.code,
          class_name: targetClass.name,
        });
        examinerByLecturerId.set(assignment.lecturer_id, bucket);
      }
    }

    const studentRows = studentMemberships
      .filter((membership) => !!membership.user && !!membership.class)
      .map((membership) => ({
        id: membership.user_id,
        email: membership.user.email,
        full_name: membership.user.full_name,
        student_id: membership.user.student_id,
        class_id: membership.class_id,
        class_code: membership.class?.code || null,
        class_name: membership.class?.name || null,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));

    return {
      semester: this.serializeSemester(semester),
      summary: {
        classes_total: classes.length,
        lecturers_total: lecturers.length,
        students_total: studentRows.length,
        assigned_classes_total: classRows.filter((row) => !!row.lecturer_id)
          .length,
        unassigned_classes_total: classRows.filter((row) => !row.lecturer_id)
          .length,
        examiner_assignments_total: examinerAssignments.length,
        can_assign_examiners: semester.current_week >= 10,
      },
      lecturers: lecturers.map((lecturer) => ({
        id: lecturer.id,
        email: lecturer.email,
        full_name: lecturer.full_name,
        teaching_classes: (teachingByLecturerId.get(lecturer.id) || []).map(
          (classRow) => ({
            class_id: classRow.id,
            class_code: classRow.code,
            class_name: classRow.name,
          }),
        ),
        examiner_classes: examinerByLecturerId.get(lecturer.id) || [],
      })),
      students: studentRows,
      classes: classRows,
    };
  }

  async listSemesterClasses(semesterId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    const roster = await this.getSemesterRoster(semester.id);
    return {
      semester: roster.semester,
      classes: roster.classes,
    };
  }

  async createSemesterClass(semesterId: string, dto: CreateSemesterClassDto) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    const existing = await this.classRepository.findOne({
      where: { semester: semester.code, code },
    });
    if (existing) {
      throw this.buildConflict(
        'CLASS_ALREADY_EXISTS',
        `Class ${code} already exists in this semester.`,
      );
    }

    const created = await this.classRepository.save(
      this.classRepository.create({
        code,
        name,
        semester: semester.code,
        lecturer_id: null,
        enrollment_key:
          dto.enrollment_key?.trim() ||
          randomBytes(4).toString('hex').toUpperCase(),
      }),
    );

    return this.buildSemesterClassRow(created, null, []);
  }

  async updateSemesterClass(
    semesterId: string,
    classId: string,
    dto: UpdateSemesterClassDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);
    const targetClass = await this.getSemesterClassOrThrow(
      semester.code,
      classId,
    );

    if (dto.code?.trim()) {
      const nextCode = dto.code.trim().toUpperCase();
      const existing = await this.classRepository.findOne({
        where: { semester: semester.code, code: nextCode },
      });
      if (existing && existing.id !== targetClass.id) {
        throw this.buildConflict(
          'CLASS_ALREADY_EXISTS',
          `Class ${nextCode} already exists in this semester.`,
        );
      }
      targetClass.code = nextCode;
    }

    if (dto.name?.trim()) {
      targetClass.name = dto.name.trim();
    }

    if (dto.enrollment_key?.trim()) {
      targetClass.enrollment_key = dto.enrollment_key.trim().toUpperCase();
    }

    const saved = await this.classRepository.save(targetClass);
    const teachingAssignment = await this.teachingAssignmentRepository.findOne({
      where: { class_id: saved.id },
      relations: ['lecturer'],
    });
    const examinerAssignments = await this.examinerAssignmentRepository.find({
      where: { semester_id: semester.id, class_id: saved.id },
      relations: ['lecturer'],
    });

    return this.buildSemesterClassRow(
      saved,
      teachingAssignment,
      examinerAssignments,
    );
  }

  async deleteSemesterClass(semesterId: string, classId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);
    const targetClass = await this.getSemesterClassOrThrow(
      semester.code,
      classId,
    );

    const [studentCount, groupCount, teachingAssignment, examinerCount] =
      await Promise.all([
        this.classMembershipRepository.count({
          where: { class_id: targetClass.id },
        }),
        this.groupRepository.count({ where: { class_id: targetClass.id } }),
        this.teachingAssignmentRepository.findOne({
          where: { class_id: targetClass.id },
        }),
        this.examinerAssignmentRepository.count({
          where: { semester_id: semester.id, class_id: targetClass.id },
        }),
      ]);

    if (
      studentCount > 0 ||
      groupCount > 0 ||
      teachingAssignment ||
      examinerCount > 0
    ) {
      throw this.buildConflict(
        'CLASS_DELETE_CONFLICT',
        'Class cannot be deleted while it still has students, groups, or assignments.',
        {
          student_count: studentCount,
          group_count: groupCount,
          has_teaching_assignment: Boolean(teachingAssignment),
          examiner_assignment_count: examinerCount,
        },
      );
    }

    await this.classRepository.delete({ id: targetClass.id });
    return { success: true };
  }

  async generateSemesterClassGroups(
    semesterId: string,
    classId: string,
    actorUserId: string,
    groupCount?: number,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);
    const targetClass = await this.getSemesterClassOrThrow(
      semester.code,
      classId,
    );

    const desiredTotal = groupCount ?? targetClass.max_groups ?? 7;
    const existingGroups = await this.groupRepository.find({
      where: { class_id: targetClass.id },
      order: { created_at: 'ASC' },
    });

    const existingCount = existingGroups.length;
    if (existingCount >= desiredTotal) {
      return {
        class_id: targetClass.id,
        class_code: targetClass.code,
        desired_group_count: desiredTotal,
        existing_group_count: existingCount,
        created_group_count: 0,
      };
    }

    const existingNames = new Set(
      existingGroups.map((group) => group.name.trim().toLowerCase()),
    );
    const creatorId =
      targetClass.lecturer_id || (await this.getOrCreateSeedLecturerId());
    const groupsToCreate: Group[] = [];

    let sequence = 1;
    while (existingCount + groupsToCreate.length < desiredTotal) {
      const candidateName = `Group ${sequence}`;
      sequence += 1;

      if (existingNames.has(candidateName.toLowerCase())) {
        continue;
      }

      existingNames.add(candidateName.toLowerCase());
      groupsToCreate.push(
        this.groupRepository.create({
          name: candidateName,
          class_id: targetClass.id,
          semester: semester.code,
          created_by_id: creatorId,
        }),
      );
    }

    await this.groupRepository.save(groupsToCreate);

    this.logger.log(
      JSON.stringify({
        event: 'semester_class_groups_generated',
        semester_id: semester.id,
        class_id: targetClass.id,
        class_code: targetClass.code,
        desired_group_count: desiredTotal,
        existing_group_count: existingCount,
        created_group_count: groupsToCreate.length,
        actor_user_id: actorUserId,
      }),
    );

    return {
      class_id: targetClass.id,
      class_code: targetClass.code,
      desired_group_count: desiredTotal,
      existing_group_count: existingCount,
      created_group_count: groupsToCreate.length,
    };
  }

  async createSemesterLecturer(
    semesterId: string,
    dto: CreateSemesterLecturerDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const email = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({
      where: { email },
    });
    if (existing) {
      if (existing.role !== Role.LECTURER) {
        throw this.buildConflict(
          'USER_ROLE_CONFLICT',
          `Email ${email} already belongs to a non-lecturer account.`,
        );
      }
      throw this.buildConflict(
        'LECTURER_ALREADY_EXISTS',
        `Lecturer account ${email} already exists.`,
      );
    }

    const password = dto.password?.trim() || randomBytes(8).toString('hex');
    const lecturer = await this.userRepository.save(
      this.userRepository.create({
        email,
        full_name: dto.full_name.trim(),
        password_hash: await bcrypt.hash(password, 10),
        role: Role.LECTURER,
        primary_provider: AuthProvider.EMAIL,
      }),
    );

    this.logger.log(
      JSON.stringify({
        event: 'semester_roster_lecturer_created',
        semester_id: semester.id,
        lecturer_id: lecturer.id,
        email,
      }),
    );

    return {
      id: lecturer.id,
      email: lecturer.email,
      full_name: lecturer.full_name,
      role: lecturer.role,
    };
  }

  async updateSemesterLecturer(
    semesterId: string,
    lecturerId: string,
    dto: UpdateSemesterLecturerDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const lecturer = await this.userRepository.findOne({
      where: { id: lecturerId, role: Role.LECTURER },
    });
    if (!lecturer) {
      throw this.buildNotFound('LECTURER_NOT_FOUND', 'Lecturer not found.');
    }

    if (dto.email?.trim()) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.userRepository.findOne({ where: { email } });
      if (existing && existing.id !== lecturer.id) {
        throw this.buildConflict(
          'LECTURER_ALREADY_EXISTS',
          `Lecturer account ${email} already exists.`,
        );
      }
      lecturer.email = email;
    }

    if (dto.full_name?.trim()) {
      lecturer.full_name = dto.full_name.trim();
    }

    if (dto.password?.trim()) {
      lecturer.password_hash = await bcrypt.hash(dto.password.trim(), 10);
    }

    const savedLecturer = await this.userRepository.save(lecturer);
    return {
      id: savedLecturer.id,
      email: savedLecturer.email,
      full_name: savedLecturer.full_name,
      role: savedLecturer.role,
    };
  }

  async deleteSemesterLecturer(semesterId: string, lecturerId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const lecturer = await this.userRepository.findOne({
      where: { id: lecturerId, role: Role.LECTURER },
    });
    if (!lecturer) {
      throw this.buildNotFound('LECTURER_NOT_FOUND', 'Lecturer not found.');
    }

    const [teachingCount, examinerCount] = await Promise.all([
      this.classRepository.count({ where: { lecturer_id: lecturerId } }),
      this.examinerAssignmentRepository.count({
        where: { lecturer_id: lecturerId },
      }),
    ]);

    if (teachingCount > 0 || examinerCount > 0) {
      throw this.buildConflict(
        'LECTURER_STILL_ASSIGNED',
        'Lecturer is still assigned to classes or examiner duties.',
      );
    }

    await this.userRepository.delete({ id: lecturerId });
    return { success: true };
  }

  async createSemesterStudent(
    semesterId: string,
    dto: CreateSemesterStudentDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const targetClass = await this.getSemesterClassOrThrow(
      semester.code,
      dto.class_id,
    );
    const email = dto.email.trim().toLowerCase();
    let student = await this.userRepository.findOne({ where: { email } });

    if (student && student.role !== Role.STUDENT) {
      throw this.buildConflict(
        'USER_ROLE_CONFLICT',
        `Email ${email} already belongs to a non-student account.`,
      );
    }

    if (!student) {
      const password = dto.password?.trim() || randomBytes(8).toString('hex');
      student = await this.userRepository.save(
        this.userRepository.create({
          email,
          student_id: dto.student_id.trim(),
          full_name: dto.full_name.trim(),
          password_hash: await bcrypt.hash(password, 10),
          role: Role.STUDENT,
          primary_provider: AuthProvider.EMAIL,
        }),
      );
    } else {
      student.full_name = dto.full_name.trim();
      student.student_id = dto.student_id.trim();
      student = await this.userRepository.save(student);
    }

    const semesterClassIds = await this.getSemesterClassIds(semester.code);
    const existingMemberships =
      semesterClassIds.length === 0
        ? []
        : await this.classMembershipRepository.find({
            where: {
              user_id: student.id,
              class_id: In(semesterClassIds),
            },
          });

    if (
      existingMemberships.some(
        (membership) => membership.class_id === targetClass.id,
      )
    ) {
      throw this.buildConflict(
        'STUDENT_ALREADY_IN_SEMESTER',
        'Student is already enrolled in the selected class for this semester.',
      );
    }

    if (existingMemberships.length > 0) {
      throw this.buildConflict(
        'STUDENT_ALREADY_IN_SEMESTER',
        'Student is already enrolled in another class for this semester.',
      );
    }

    await this.classMembershipRepository.save(
      this.classMembershipRepository.create({
        class_id: targetClass.id,
        user_id: student.id,
      }),
    );

    return {
      id: student.id,
      email: student.email,
      full_name: student.full_name,
      student_id: student.student_id,
      class_id: targetClass.id,
      class_code: targetClass.code,
      class_name: targetClass.name,
    };
  }

  async updateSemesterStudent(
    semesterId: string,
    studentId: string,
    dto: UpdateSemesterStudentDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const student = await this.userRepository.findOne({
      where: { id: studentId, role: Role.STUDENT },
    });
    if (!student) {
      throw this.buildNotFound('STUDENT_NOT_FOUND', 'Student not found.');
    }

    if (dto.email?.trim()) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.userRepository.findOne({ where: { email } });
      if (existing && existing.id !== student.id) {
        throw this.buildConflict(
          'USER_ROLE_CONFLICT',
          `Email ${email} already belongs to another account.`,
        );
      }
      student.email = email;
    }
    if (dto.full_name?.trim()) {
      student.full_name = dto.full_name.trim();
    }
    if (dto.student_id?.trim()) {
      student.student_id = dto.student_id.trim();
    }
    if (dto.password?.trim()) {
      student.password_hash = await bcrypt.hash(dto.password.trim(), 10);
    }
    await this.userRepository.save(student);

    if (dto.class_id) {
      const targetClass = await this.getSemesterClassOrThrow(
        semester.code,
        dto.class_id,
      );
      const semesterClassIds = await this.getSemesterClassIds(semester.code);
      const existingMemberships =
        semesterClassIds.length === 0
          ? []
          : await this.classMembershipRepository.find({
              where: {
                user_id: student.id,
                class_id: In(semesterClassIds),
              },
            });
      const currentMembership = existingMemberships[0];
      if (!currentMembership) {
        await this.classMembershipRepository.save(
          this.classMembershipRepository.create({
            class_id: targetClass.id,
            user_id: student.id,
          }),
        );
      } else if (currentMembership.class_id !== targetClass.id) {
        await this.classMembershipRepository.delete({
          class_id: currentMembership.class_id,
          user_id: student.id,
        });
        await this.classMembershipRepository.save(
          this.classMembershipRepository.create({
            class_id: targetClass.id,
            user_id: student.id,
          }),
        );
      }
    }

    return this.getSemesterRosterStudent(semester.code, student.id);
  }

  async deleteSemesterStudent(semesterId: string, studentId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);
    const semesterClassIds = await this.getSemesterClassIds(semester.code);
    if (semesterClassIds.length === 0) {
      throw this.buildNotFound(
        'STUDENT_NOT_FOUND',
        'Student is not enrolled in this semester.',
      );
    }

    const memberships = await this.classMembershipRepository.find({
      where: { user_id: studentId, class_id: In(semesterClassIds) },
    });
    if (memberships.length === 0) {
      throw this.buildNotFound(
        'STUDENT_NOT_FOUND',
        'Student is not enrolled in this semester.',
      );
    }

    for (const membership of memberships) {
      await this.classMembershipRepository.delete({
        class_id: membership.class_id,
        user_id: membership.user_id,
      });
    }

    return { success: true };
  }

  async bulkReassignTeachingAssignments(
    semesterId: string,
    actorUserId: string,
    dto: BulkTeachingAssignmentDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    this.assertSemesterRosterEditable(semester);

    const touchedClasses: string[] = [];
    for (const assignment of dto.assignments) {
      const [targetClass, lecturer] = await Promise.all([
        this.getSemesterClassOrThrow(semester.code, assignment.class_id),
        this.userRepository.findOne({
          where: { id: assignment.lecturer_id, role: Role.LECTURER },
        }),
      ]);

      if (!lecturer) {
        throw this.buildNotFound('LECTURER_NOT_FOUND', 'Lecturer not found.');
      }

      await this.classRepository.update(
        { id: targetClass.id },
        { lecturer_id: lecturer.id },
      );
      await this.upsertTeachingAssignment(
        semester.id,
        targetClass.id,
        lecturer.id,
        actorUserId,
      );
      touchedClasses.push(targetClass.id);
    }

    this.logger.log(
      JSON.stringify({
        event: 'semester_teaching_assignment_bulk_updated',
        actor_user_id: actorUserId,
        semester_id: semester.id,
        touched_class_count: touchedClasses.length,
      }),
    );

    return this.getSemesterRoster(semester.id);
  }

  async getExaminerAssignments(semesterId: string) {
    const semester = await this.getSemesterOrThrow(semesterId);
    return this.buildExaminerAssignmentBoard(semester);
  }

  async bulkAssignExaminers(
    semesterId: string,
    actorUserId: string,
    dto: BulkExaminerAssignmentDto,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    if (semester.current_week < 10) {
      throw this.buildBadRequest(
        'WEEK_GATE_NOT_REACHED',
        'Examiner assignment is only available from week 10 onward.',
      );
    }

    const classes = await this.classRepository.find({
      where: { semester: semester.code },
      relations: ['lecturer'],
    });
    const classMap = new Map(classes.map((item) => [item.id, item]));
    const uniqueLecturerIds = Array.from(
      new Set(dto.assignments.flatMap((item) => item.lecturer_ids)),
    );
    const lecturers =
      uniqueLecturerIds.length === 0
        ? []
        : await this.userRepository.find({
            where: uniqueLecturerIds.map((id) => ({ id, role: Role.LECTURER })),
          });
    const lecturerMap = new Map(
      lecturers.map((lecturer) => [lecturer.id, lecturer]),
    );

    for (const assignment of dto.assignments) {
      const targetClass = classMap.get(assignment.class_id);
      if (!targetClass) {
        throw this.buildBadRequest(
          'CLASS_NOT_IN_SEMESTER',
          'Class does not belong to the selected semester.',
        );
      }

      const dedupedLecturerIds = Array.from(new Set(assignment.lecturer_ids));
      for (const lecturerId of dedupedLecturerIds) {
        const lecturer = lecturerMap.get(lecturerId);
        if (!lecturer) {
          throw this.buildNotFound('LECTURER_NOT_FOUND', 'Lecturer not found.');
        }
        if (targetClass.lecturer_id === lecturerId) {
          throw this.buildConflict(
            'EXAMINER_OWN_CLASS_CONFLICT',
            'Lecturer cannot examine a class they are teaching.',
            { class_id: targetClass.id, lecturer_id: lecturerId },
          );
        }
      }
    }

    const targetClassIds = dto.assignments.map(
      (assignment) => assignment.class_id,
    );
    if (targetClassIds.length > 0) {
      await this.examinerAssignmentRepository.delete({
        semester_id: semester.id,
        class_id: In(targetClassIds),
      });
    }

    const inserts = dto.assignments.flatMap((assignment) =>
      Array.from(new Set(assignment.lecturer_ids)).map((lecturerId) =>
        this.examinerAssignmentRepository.create({
          semester_id: semester.id,
          class_id: assignment.class_id,
          lecturer_id: lecturerId,
          assigned_by_id: actorUserId,
        }),
      ),
    );
    if (inserts.length > 0) {
      await this.examinerAssignmentRepository.save(inserts);
    }

    this.logger.log(
      JSON.stringify({
        event: 'semester_examiner_assignment_bulk_updated',
        actor_user_id: actorUserId,
        semester_id: semester.id,
        assignment_count: inserts.length,
      }),
    );

    return this.buildExaminerAssignmentBoard(semester);
  }

  async getImportBatches(semesterId: string) {
    await this.getSemesterOrThrow(semesterId);

    return this.importBatchRepository.find({
      where: { semester_id: semesterId },
      relations: ['rows'],
      order: { created_at: 'DESC' },
      take: 10,
    });
  }

  async processImport(
    semesterId: string,
    uploadedById: string,
    fileName: string,
    rows: SemesterImportRow[],
    mode: ImportMode,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    if (semester.status === SemesterStatus.CLOSED) {
      throw new BadRequestException('Cannot import into a closed semester.');
    }

    const summary = {
      rows: {
        total: rows.length,
        success: 0,
        failed: 0,
        skipped: 0,
      },
      classes: { created: 0, updated: 0 },
      lecturers: { created: 0, updated: 0 },
      students: { created: 0, updated: 0 },
      enrollments: { created: 0, skipped: 0 },
    };
    const counterKeys = {
      classes: { created: new Set<string>(), updated: new Set<string>() },
      lecturers: { created: new Set<string>(), updated: new Set<string>() },
      students: { created: new Set<string>(), updated: new Set<string>() },
      enrollments: { created: new Set<string>(), skipped: new Set<string>() },
    };
    const markCounter = <
      TSection extends keyof typeof counterKeys,
      TField extends keyof (typeof counterKeys)[TSection],
    >(
      section: TSection,
      field: TField,
      key: string,
    ) => {
      const bucket = counterKeys[section][field] as Set<string>;
      if (!bucket.has(key)) {
        bucket.add(key);
        (summary[section] as Record<string, number>)[field as string] += 1;
      }
    };

    const correlationId = randomBytes(6).toString('hex');
    const batch = await this.importBatchRepository.save(
      this.importBatchRepository.create({
        semester_id: semester.id,
        uploaded_by_id: uploadedById,
        file_name: fileName,
        mode,
        total_rows: rows.length,
        correlation_id: correlationId,
      }),
    );

    const rowLogs: ImportRowLog[] = [];
    const existingUsers = new Map(
      (
        await this.userRepository.find({
          where: rows.map((row) => ({ email: row.email.toLowerCase() })),
        })
      ).map((user) => [user.email.toLowerCase(), user]),
    );
    const existingClasses = new Map(
      (
        await this.classRepository.find({
          where: rows.map((row) => ({
            code: row.class_code,
            semester: semester.code,
          })),
          relations: ['lecturer'],
        })
      ).map((classItem) => [`${semester.code}:${classItem.code}`, classItem]),
    );
    const ensureClassForCode = (classCode: string, className?: string) => {
      const key = `${semester.code}:${classCode}`;
      const currentClass = existingClasses.get(key);
      if (currentClass) {
        if (mode === 'IMPORT' && className && currentClass.name !== className) {
          void this.classRepository.update(
            { id: currentClass.id },
            { name: className },
          );
          currentClass.name = className;
        }

        markCounter('classes', 'updated', key);
        return currentClass;
      }

      return null;
    };

    for (const row of rows) {
      const normalizedRole = row.role?.trim().toUpperCase() || '';
      const resolvedRole = Role.STUDENT;
      const normalizedSemesterCode = row.semester_code.trim().toUpperCase();
      const normalizedEmail = row.email.trim().toLowerCase();
      const normalizedClassCode = row.class_code.trim().toUpperCase();
      const normalizedClassName = row.class_name?.trim();
      const logPayload = { ...row };

      const fail = (message: string) => {
        summary.rows.failed += 1;
        rowLogs.push(
          this.importRowLogRepository.create({
            batch_id: batch.id,
            row_number: row.row_number,
            role: resolvedRole,
            email: normalizedEmail || null,
            class_code: normalizedClassCode || null,
            status: 'FAILED',
            message,
            payload: logPayload,
          }),
        );
      };

      if (normalizedRole === Role.LECTURER) {
        fail(
          'Lecturer rows are no longer supported in semester import. Use Teaching Assignments to map lecturers to classes.',
        );
        continue;
      }
      if (normalizedRole && normalizedRole !== Role.STUDENT) {
        fail('Role must be STUDENT when provided.');
        continue;
      }
      if (!normalizedSemesterCode || !normalizedEmail || !normalizedClassCode) {
        fail('Missing required fields: semester_code, email, class_code.');
        continue;
      }
      if (normalizedSemesterCode !== semester.code) {
        fail(
          `semester_code ${normalizedSemesterCode} does not match selected semester ${semester.code}.`,
        );
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        fail('Invalid email format.');
        continue;
      }
      if (!row.student_id.trim()) {
        fail('student_id is required for student import rows.');
        continue;
      }

      try {
        let student = existingUsers.get(normalizedEmail);
        let createdStudent = false;

        if (student && student.role !== Role.STUDENT) {
          fail(`Email ${row.email} already belongs to a non-student account.`);
          continue;
        }

        if (!student && mode === 'IMPORT') {
          student = await this.userRepository.save(
            this.userRepository.create({
              email: normalizedEmail,
              full_name: row.full_name.trim(),
              student_id: row.student_id.trim(),
              password_hash: await bcrypt.hash(
                randomBytes(8).toString('hex'),
                10,
              ),
              role: Role.STUDENT,
              primary_provider: AuthProvider.EMAIL,
            }),
          );
          existingUsers.set(normalizedEmail, student);
          createdStudent = true;
        }

        if (!student && mode === 'VALIDATE') {
          createdStudent = true;
        }

        if (createdStudent) {
          markCounter('students', 'created', normalizedEmail);
        } else {
          markCounter('students', 'updated', normalizedEmail);
        }

        const targetClass = ensureClassForCode(
          normalizedClassCode,
          normalizedClassName,
        );
        if (!targetClass) {
          fail(
            `Class ${normalizedClassCode} is not provisioned in selected semester. Admin must create/maintain classes before student import.`,
          );
          continue;
        }

        if (mode === 'IMPORT') {
          const existingMembership =
            await this.classMembershipRepository.findOne({
              where: { class_id: targetClass.id, user_id: student!.id },
            });

          if (existingMembership) {
            summary.rows.skipped += 1;
            markCounter(
              'enrollments',
              'skipped',
              `${targetClass.id}:${student!.id}`,
            );
            rowLogs.push(
              this.importRowLogRepository.create({
                batch_id: batch.id,
                row_number: row.row_number,
                role: resolvedRole,
                email: normalizedEmail,
                class_code: normalizedClassCode,
                status: 'SKIPPED',
                message: 'Student is already enrolled in this class.',
                payload: logPayload,
              }),
            );
            continue;
          }

          await this.classMembershipRepository.save(
            this.classMembershipRepository.create({
              class_id: targetClass.id,
              user_id: student!.id,
            }),
          );
          markCounter(
            'enrollments',
            'created',
            `${targetClass.id}:${student!.id}`,
          );
        }

        summary.rows.success += 1;
        rowLogs.push(
          this.importRowLogRepository.create({
            batch_id: batch.id,
            row_number: row.row_number,
            role: resolvedRole,
            email: normalizedEmail,
            class_code: normalizedClassCode,
            status: 'SUCCESS',
            message:
              mode === 'VALIDATE'
                ? 'Student row validated successfully.'
                : 'Student enrolled successfully.',
            payload: logPayload,
          }),
        );
      } catch (error) {
        fail(
          error instanceof Error ? error.message : 'Unexpected import error.',
        );
      }
    }

    batch.success_rows = summary.rows.success;
    batch.failed_rows = summary.rows.failed;
    batch.summary = summary as unknown as Record<string, unknown>;
    await this.importBatchRepository.save(batch);
    if (rowLogs.length > 0) {
      await this.importRowLogRepository.save(rowLogs);
    }

    this.logger.log(
      `[${batch.correlation_id}] ${mode} completed for semester ${semester.code}: ${summary.rows.success} success, ${summary.rows.failed} failed, ${summary.rows.skipped} skipped.`,
    );

    return {
      batchId: batch.id,
      correlationId: batch.correlation_id,
      semester: {
        id: semester.id,
        code: semester.code,
        name: semester.name,
        status: semester.status,
      },
      summary,
      readyForImport: summary.rows.failed === 0,
      rows: rowLogs.map((log) => ({
        row_number: log.row_number,
        role: log.role,
        email: log.email,
        class_code: log.class_code,
        status: log.status,
        message: log.message,
      })),
    };
  }

  private isTopicFinalized(group: Pick<Group, 'topic_id' | 'project_name'>) {
    return !!group.topic_id || !!group.project_name?.trim();
  }

  private resolveReviewMilestone(
    currentWeek: number,
  ): ReviewMilestoneContext | null {
    if (currentWeek >= 3 && currentWeek <= 4) {
      return {
        code: ReviewMilestoneCode.REVIEW_1,
        label: 'Review 1',
        week_start: 3,
        week_end: 4,
      };
    }

    if (currentWeek >= 5 && currentWeek <= 6) {
      return {
        code: ReviewMilestoneCode.PROGRESS_TRACKING,
        label: 'Progress Tracking',
        week_start: 5,
        week_end: 6,
      };
    }

    if (currentWeek >= 7 && currentWeek <= 8) {
      return {
        code: ReviewMilestoneCode.REVIEW_2,
        label: 'Review 2',
        week_start: 7,
        week_end: 8,
      };
    }

    if (currentWeek >= 9 && currentWeek <= 10) {
      return {
        code: ReviewMilestoneCode.REVIEW_3,
        label: 'Review 3',
        week_start: 9,
        week_end: 10,
      };
    }

    if (currentWeek >= 11 && currentWeek <= 12) {
      return {
        code: ReviewMilestoneCode.FINAL_PRESENTATION,
        label: 'Final Presentation',
        week_start: 11,
        week_end: 12,
      };
    }

    return null;
  }

  private async getReviewMapForGroups(
    semesterId: string,
    milestone: ReviewMilestoneContext | null,
    groupIds: string[],
  ) {
    if (!milestone || groupIds.length === 0) {
      return new Map<string, GroupReview>();
    }

    const reviews = await this.groupReviewRepository.find({
      where: {
        semester_id: semesterId,
        group_id: In(groupIds),
        milestone_code: milestone.code,
      },
    });

    return new Map(reviews.map((review) => [review.group_id, review]));
  }

  private serializeReviewGroup(
    group: Pick<Group, 'id' | 'name' | 'project_name'> & {
      topic?: { name?: string | null } | null;
    },
    review: GroupReview | undefined,
    milestone: ReviewMilestoneContext | null,
    forStudent = false,
  ) {
    const warnings = this.buildReviewWarnings(review, milestone);
    const isPublished = review?.is_published ?? false;
    const showScores = !forStudent || isPublished;
    const reviewStatus: ReviewMilestoneStatus = review ? 'REVIEWED' : 'PENDING';
    const totalScore =
      (Number(review?.task_progress_score ?? 0) || 0) +
      (Number(review?.commit_contribution_score ?? 0) || 0) +
      (Number(review?.review_milestone_score ?? 0) || 0);

    return {
      group_id: group.id,
      group_name: group.name,
      topic_name: group.topic?.name || group.project_name || null,
      review_status: reviewStatus,
      is_published: isPublished,
      scores: showScores
        ? {
            task_progress_score: review?.task_progress_score ?? null,
            commit_contribution_score:
              review?.commit_contribution_score ?? null,
            review_milestone_score: review?.review_milestone_score ?? null,
            total_score: review ? Number(totalScore.toFixed(2)) : null,
          }
        : {
            task_progress_score: null,
            commit_contribution_score: null,
            review_milestone_score: null,
            total_score: null,
          },
      lecturer_note: showScores ? (review?.lecturer_note ?? null) : null,
      snapshot: showScores
        ? {
            task_total: review?.snapshot_task_total ?? 0,
            task_done: review?.snapshot_task_done ?? 0,
            commit_total: review?.snapshot_commit_total ?? null,
            commit_contributors: review?.snapshot_commit_contributors ?? null,
            repository: review?.snapshot_repository ?? null,
            captured_at: review?.snapshot_captured_at ?? null,
          }
        : {
            task_total: 0,
            task_done: 0,
            commit_total: null,
            commit_contributors: null,
            repository: null,
            captured_at: null,
          },
      warnings,
      milestone: milestone,
    };
  }

  private buildReviewWarnings(
    review: GroupReview | undefined,
    milestone: ReviewMilestoneContext | null,
  ) {
    const warnings: string[] = [];

    if (!milestone) {
      return warnings;
    }

    if (!review) {
      warnings.push('REVIEW_NOT_CAPTURED');
      return warnings;
    }

    if (review.snapshot_task_total <= 0) {
      warnings.push('NO_TASK_EVIDENCE');
    }

    if (
      review.snapshot_commit_total === null ||
      review.snapshot_commit_total === undefined ||
      review.snapshot_commit_total <= 0
    ) {
      warnings.push('NO_COMMIT_EVIDENCE');
    }

    return warnings;
  }

  private async captureReviewSnapshot(group: Pick<Group, 'id'>): Promise<{
    task_total: number;
    task_done: number;
    commit_total: number | null;
    commit_contributors: number | null;
    repository: string | null;
    captured_at: Date;
  }> {
    const tasks = await this.taskRepository.find({
      where: {
        group_id: group.id,
        deleted_at: IsNull(),
      },
      select: {
        id: true,
        status: true,
      },
    });

    let commitTotal: number | null = null;
    let commitContributors: number | null = null;
    let repository: string | null = null;

    const primaryRepo =
      (await this.groupRepositoryLinkRepository.findOne({
        where: { group_id: group.id, is_primary: true },
      })) ||
      (await this.groupRepositoryLinkRepository.findOne({
        where: { group_id: group.id },
        order: { created_at: 'ASC' },
      }));

    if (primaryRepo) {
      repository = `${primaryRepo.repo_owner}/${primaryRepo.repo_name}`;

      try {
        const commits = await this.githubService.getRepoCommits(
          primaryRepo.added_by_id,
          primaryRepo.repo_owner,
          primaryRepo.repo_name,
        );
        commitTotal = commits.length;
        commitContributors = new Set(
          commits.map((commit) => commit.author || 'Unknown'),
        ).size;
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'review_snapshot_commit_fetch_failed',
            group_id: group.id,
            repository,
            message:
              error instanceof Error
                ? error.message
                : 'Failed to capture commit snapshot.',
          }),
        );
      }
    }

    return {
      task_total: tasks.length,
      task_done: tasks.filter((task) => task.status === TaskStatus.DONE).length,
      commit_total: commitTotal,
      commit_contributors: commitContributors,
      repository,
      captured_at: new Date(),
    };
  }

  private async buildExaminerAssignmentBoard(semester: Semester) {
    const classes = await this.classRepository.find({
      where: { semester: semester.code },
      relations: ['lecturer'],
      order: { code: 'ASC' },
    });
    const classIds = classes.map((item) => item.id);
    const [lecturers, examinerAssignments] = await Promise.all([
      this.userRepository.find({
        where: { role: Role.LECTURER },
        order: { full_name: 'ASC', email: 'ASC' },
      }),
      classIds.length === 0
        ? Promise.resolve([])
        : this.examinerAssignmentRepository.find({
            where: { semester_id: semester.id, class_id: In(classIds) },
            relations: ['lecturer'],
          }),
    ]);

    const examinerByClassId = new Map<string, ExaminerAssignment[]>();
    for (const assignment of examinerAssignments) {
      const bucket = examinerByClassId.get(assignment.class_id) || [];
      bucket.push(assignment);
      examinerByClassId.set(assignment.class_id, bucket);
    }

    const teachingByLecturer = new Map<
      string,
      Array<{ class_id: string; class_code: string; class_name: string }>
    >();
    for (const classItem of classes) {
      if (!classItem.lecturer_id) continue;
      const bucket = teachingByLecturer.get(classItem.lecturer_id) || [];
      bucket.push({
        class_id: classItem.id,
        class_code: classItem.code,
        class_name: classItem.name,
      });
      teachingByLecturer.set(classItem.lecturer_id, bucket);
    }

    return {
      semester: this.serializeSemester(semester),
      gate: {
        current_week: semester.current_week,
        can_assign: semester.current_week >= 10,
        reason: semester.current_week >= 10 ? null : 'WEEK_GATE_NOT_REACHED',
      },
      lecturers: lecturers.map((lecturer) => ({
        id: lecturer.id,
        email: lecturer.email,
        full_name: lecturer.full_name,
        teaching_classes: teachingByLecturer.get(lecturer.id) || [],
      })),
      classes: classes.map((classItem) => ({
        id: classItem.id,
        code: classItem.code,
        name: classItem.name,
        lecturer_id: classItem.lecturer_id,
        lecturer_name: classItem.lecturer?.full_name || null,
        examiner_assignments: (examinerByClassId.get(classItem.id) || []).map(
          (assignment) => ({
            lecturer_id: assignment.lecturer_id,
            lecturer_name:
              assignment.lecturer?.full_name || assignment.lecturer?.email,
            lecturer_email: assignment.lecturer?.email || null,
          }),
        ),
      })),
    };
  }

  private async getSemesterClassIds(semesterCode: string) {
    const classes = await this.classRepository.find({
      where: { semester: semesterCode },
      select: { id: true } as any,
    });
    return classes.map((classItem) => classItem.id);
  }

  private buildSemesterClassRow(
    classItem: Class,
    teachingAssignment?: TeachingAssignment | null,
    examinerAssignments: ExaminerAssignment[] = [],
  ) {
    const teachingLecturer = teachingAssignment?.lecturer || classItem.lecturer;
    return {
      id: classItem.id,
      code: classItem.code,
      name: classItem.name,
      lecturer_id: teachingLecturer?.id || classItem.lecturer_id,
      lecturer_name: teachingLecturer?.full_name || null,
      student_count: 0,
      enrollment_key: classItem.enrollment_key,
      examiner_assignments: examinerAssignments.map((assignment) => ({
        lecturer_id: assignment.lecturer_id,
        lecturer_name:
          assignment.lecturer?.full_name || assignment.lecturer?.email,
        lecturer_email: assignment.lecturer?.email || null,
      })),
    };
  }

  private async getSemesterClassOrThrow(semesterCode: string, classId: string) {
    const targetClass = await this.classRepository.findOne({
      where: { id: classId, semester: semesterCode },
    });
    if (!targetClass) {
      throw this.buildBadRequest(
        'CLASS_NOT_IN_SEMESTER',
        'Class does not belong to the selected semester.',
      );
    }
    return targetClass;
  }

  private async getSemesterRosterStudent(
    semesterCode: string,
    studentId: string,
  ) {
    const semesterClassIds = await this.getSemesterClassIds(semesterCode);
    const membership =
      semesterClassIds.length === 0
        ? null
        : await this.classMembershipRepository.findOne({
            where: {
              user_id: studentId,
              class_id: In(semesterClassIds),
            },
            relations: ['class', 'user'],
          });

    if (!membership?.user || !membership.class) {
      throw this.buildNotFound(
        'STUDENT_NOT_FOUND',
        'Student is not enrolled in this semester.',
      );
    }

    return {
      id: membership.user_id,
      email: membership.user.email,
      full_name: membership.user.full_name,
      student_id: membership.user.student_id,
      class_id: membership.class_id,
      class_code: membership.class.code,
      class_name: membership.class.name,
    };
  }

  private async upsertTeachingAssignment(
    semesterId: string,
    classId: string,
    lecturerId: string,
    actorUserId?: string,
  ) {
    const existing = await this.teachingAssignmentRepository.findOne({
      where: { class_id: classId },
    });

    if (existing) {
      existing.semester_id = semesterId;
      existing.lecturer_id = lecturerId;
      existing.assigned_by_id = actorUserId || existing.assigned_by_id;
      return this.teachingAssignmentRepository.save(existing);
    }

    return this.teachingAssignmentRepository.save(
      this.teachingAssignmentRepository.create({
        semester_id: semesterId,
        class_id: classId,
        lecturer_id: lecturerId,
        assigned_by_id: actorUserId || null,
      }),
    );
  }

  private assertSemesterRosterEditable(semester: Semester) {
    if (
      ![SemesterStatus.UPCOMING, SemesterStatus.ACTIVE].includes(
        semester.status,
      )
    ) {
      throw this.buildBadRequest(
        'SEMESTER_NOT_EDITABLE',
        'Roster can only be managed for UPCOMING or ACTIVE semesters.',
      );
    }
  }

  private buildBadRequest(
    code: RosterErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    return new BadRequestException({ code, message, details });
  }

  private buildConflict(
    code: RosterErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    return new ConflictException({ code, message, details });
  }

  private buildNotFound(
    code: RosterErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    return new NotFoundException({ code, message, details });
  }

  private serializeSemester(semester: Semester): SerializedSemester {
    return {
      id: semester.id,
      code: semester.code,
      name: semester.name,
      status: semester.status,
      current_week: semester.current_week,
      start_date: semester.start_date,
      end_date: semester.end_date,
    };
  }

  private async seedDefaultClassesForSemester(semesterCode: string) {
    const existingClasses =
      (await this.classRepository.find({
        where: this.defaultSemesterClassCodes.map((code) => ({
          code,
          semester: semesterCode,
        })),
      })) || [];

    const existingCodes = new Set(existingClasses.map((item) => item.code));
    const missingCodes = this.defaultSemesterClassCodes.filter(
      (code) => !existingCodes.has(code),
    );

    if (missingCodes.length === 0) {
      return;
    }

    const lecturerId = await this.getOrCreateSeedLecturerId();
    const classesToSeed = missingCodes.map((code) =>
      this.classRepository.create({
        code,
        name: code,
        semester: semesterCode,
        lecturer_id: lecturerId,
        enrollment_key: randomBytes(4).toString('hex').toUpperCase(),
      }),
    );

    await this.classRepository.save(classesToSeed);

    this.logger.log(
      JSON.stringify({
        event: 'semester_default_classes_seeded',
        semester_code: semesterCode,
        class_codes: missingCodes,
      }),
    );
  }

  private async getOrCreateSeedLecturerId() {
    const existing = await this.userRepository.findOne({
      where: { email: this.seedLecturerEmail },
    });

    if (existing) {
      if (existing.role !== Role.LECTURER) {
        throw new ConflictException(
          `Seed lecturer email ${this.seedLecturerEmail} already exists with a non-lecturer role.`,
        );
      }
      return existing.id;
    }

    const seedLecturer = await this.userRepository.save(
      this.userRepository.create({
        email: this.seedLecturerEmail,
        full_name: 'System Seed Lecturer',
        password_hash: null,
        role: Role.LECTURER,
        primary_provider: AuthProvider.EMAIL,
        is_email_verified: true,
      }),
    );

    return seedLecturer.id;
  }

  private isWeekOverrideEnabled() {
    const rawValue =
      this.configService.get<string>('DEMO_WEEK_OVERRIDE_ENABLED') || 'false';
    return ['true', '1', 'yes', 'on'].includes(rawValue.toLowerCase());
  }

  private assertWeekOverrideAllowed(actorRole: Role) {
    if (!this.isWeekOverrideEnabled()) {
      throw new NotFoundException('Week override is not available.');
    }

    const allowedRoles =
      this.configService.get<string>('DEMO_WEEK_OVERRIDE_ALLOWED_ROLES') ||
      `${Role.ADMIN},${Role.LECTURER}`;
    const normalizedAllowedRoles = allowedRoles
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => Object.values(Role).includes(value as Role));

    if (!normalizedAllowedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        'You are not allowed to change the current week.',
      );
    }
  }

  private async getSemesterOrThrow(id: string) {
    const semester = await this.semesterRepository.findOne({
      where: { id },
    });
    if (!semester) {
      throw new NotFoundException('Semester not found.');
    }
    return semester;
  }
}
