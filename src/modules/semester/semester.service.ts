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
  Group,
  GroupMembership,
  GroupRepository,
  GroupReview,
  ImportBatch,
  ImportRowLog,
  Semester,
  SemesterWeekAuditLog,
  Task,
  User,
} from '../../entities';
import { GithubService } from '../github/github.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import { UpsertGroupReviewDto } from './dto/upsert-group-review.dto';
import { SemesterImportRow } from './utils/semester-import.util';

type ImportMode = 'VALIDATE' | 'IMPORT';
type WeekGateStatus = 'PASS' | 'FAIL';
type ReviewMilestoneStatus = 'PENDING' | 'REVIEWED';

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

    return this.semesterRepository.save(semester);
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
          week1_status: (
            activeMembers.length > 0 ? 'PASS' : 'FAIL'
          ) as WeekGateStatus,
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
        week1_status: (
          studentsWithoutGroupCount === 0 ? 'PASS' : 'FAIL'
        ) as WeekGateStatus,
        week2_status: (
          groupsWithoutTopicCount === 0 ? 'PASS' : 'FAIL'
        ) as WeekGateStatus,
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

  async getStudentWeeklyWarnings(userId: string, userRole: Role = Role.STUDENT) {
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
            week2_status: (
              this.isTopicFinalized(group) ? 'PASS' : 'FAIL'
            ) as WeekGateStatus,
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
      lecturer_note:
        dto.lecturer_note ?? existingReview?.lecturer_note ?? null,
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
        ...this.serializeReviewGroup(group, reviewMap.get(group.id), milestone),
      })),
    };
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
    const lecturerPlans = new Map<string, SemesterImportRow>();
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
    const createdClasses = new Map<string, Class>();

    for (const row of rows) {
      if (row.role.trim().toUpperCase() === Role.LECTURER) {
        const key = row.class_code.trim().toUpperCase();
        if (!lecturerPlans.has(key)) {
          lecturerPlans.set(key, {
            ...row,
            class_code: key,
            semester_code: row.semester_code.trim().toUpperCase(),
            role: Role.LECTURER,
          });
        }
      }
    }

    const ensureLecturerUser = async (plan: SemesterImportRow) => {
      const email = plan.email.toLowerCase();
      let user = existingUsers.get(email);
      let created = false;

      if (user && user.role !== Role.LECTURER) {
        throw new BadRequestException(
          `Email ${plan.email} already belongs to a non-lecturer account.`,
        );
      }

      if (!user && mode === 'IMPORT') {
        const tempPassword = randomBytes(8).toString('hex');
        user = await this.userRepository.save(
          this.userRepository.create({
            email,
            full_name: plan.full_name,
            password_hash: await bcrypt.hash(tempPassword, 10),
            role: Role.LECTURER,
            primary_provider: AuthProvider.EMAIL,
          }),
        );
        existingUsers.set(email, user);
        created = true;
      }

      if (!user && mode === 'VALIDATE') {
        created = true;
      }

      return { user, created };
    };

    const ensureClassForCode = async (classCode: string) => {
      const key = `${semester.code}:${classCode}`;
      const currentClass = createdClasses.get(key) || existingClasses.get(key);
      if (currentClass) {
        return currentClass;
      }

      const plan = lecturerPlans.get(classCode);
      if (!plan) {
        return null;
      }

      const { user, created } = await ensureLecturerUser(plan);
      if (created) {
        markCounter('lecturers', 'created', plan.email.toLowerCase());
      }

      if (mode === 'VALIDATE') {
        return {
          id: `preview-${classCode}`,
          code: classCode,
          name: plan.class_name,
          semester: semester.code,
          lecturer_id: user?.id || `preview-lecturer-${classCode}`,
          enrollment_key: 'PREVIEW',
        } as Class;
      }

      const savedClass = await this.classRepository.save(
        this.classRepository.create({
          code: classCode,
          name: plan.class_name,
          semester: semester.code,
          lecturer_id: user!.id,
          enrollment_key: randomBytes(4).toString('hex').toUpperCase(),
        }),
      );

      await this.groupRepository.insert(
        Array.from({ length: 7 }).map((_, index) => ({
          name: `Group ${index + 1}`,
          class_id: savedClass.id,
          created_by_id: user!.id,
          semester: semester.code,
        })),
      );

      createdClasses.set(key, savedClass);
      markCounter('classes', 'created', key);

      return savedClass;
    };

    for (const row of rows) {
      const normalizedRole = row.role.trim().toUpperCase();
      const normalizedSemesterCode = row.semester_code.trim().toUpperCase();
      const normalizedEmail = row.email.trim().toLowerCase();
      const normalizedClassCode = row.class_code.trim().toUpperCase();
      const normalizedClassName = row.class_name.trim();
      const logPayload = { ...row };

      const fail = (message: string) => {
        summary.rows.failed += 1;
        rowLogs.push(
          this.importRowLogRepository.create({
            batch_id: batch.id,
            row_number: row.row_number,
            role: normalizedRole || null,
            email: normalizedEmail || null,
            class_code: normalizedClassCode || null,
            status: 'FAILED',
            message,
            payload: logPayload,
          }),
        );
      };

      if (!['LECTURER', 'STUDENT'].includes(normalizedRole)) {
        fail('Role must be either LECTURER or STUDENT.');
        continue;
      }
      if (
        !normalizedSemesterCode ||
        !normalizedEmail ||
        !normalizedClassCode ||
        !normalizedClassName
      ) {
        fail(
          'Missing required fields: semester_code, email, class_code, class_name.',
        );
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
      if (normalizedRole === 'STUDENT' && !row.student_id.trim()) {
        fail('student_id is required for STUDENT rows.');
        continue;
      }

      try {
        if (normalizedRole === 'LECTURER') {
          const existingClass =
            existingClasses.get(`${semester.code}:${normalizedClassCode}`) ||
            createdClasses.get(`${semester.code}:${normalizedClassCode}`);

          const { user, created } = await ensureLecturerUser({
            ...row,
            role: normalizedRole,
            email: normalizedEmail,
            class_code: normalizedClassCode,
            class_name: normalizedClassName,
          });

          if (created) {
            markCounter('lecturers', 'created', normalizedEmail);
          } else {
            markCounter('lecturers', 'updated', normalizedEmail);
          }

          if (!existingClass) {
            await ensureClassForCode(normalizedClassCode);
          } else if (
            mode === 'IMPORT' &&
            (existingClass.name !== normalizedClassName ||
              existingClass.lecturer_id !== user?.id)
          ) {
            await this.classRepository.update(
              { id: existingClass.id },
              { name: normalizedClassName, lecturer_id: user!.id },
            );
            markCounter(
              'classes',
              'updated',
              `${semester.code}:${normalizedClassCode}`,
            );
          } else if (existingClass) {
            markCounter(
              'classes',
              'updated',
              `${semester.code}:${normalizedClassCode}`,
            );
          }

          summary.rows.success += 1;
          rowLogs.push(
            this.importRowLogRepository.create({
              batch_id: batch.id,
              row_number: row.row_number,
              role: normalizedRole,
              email: normalizedEmail,
              class_code: normalizedClassCode,
              status: 'SUCCESS',
              message: existingClass
                ? 'Lecturer/class mapping validated.'
                : 'Lecturer/class provisioning prepared.',
              payload: logPayload,
            }),
          );
          continue;
        }

        const targetClass = await ensureClassForCode(normalizedClassCode);
        if (!targetClass) {
          fail(
            'Class is not provisioned in the selected semester and no lecturer row was provided for this class.',
          );
          continue;
        }

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
                role: normalizedRole,
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
            role: normalizedRole,
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
    group: Pick<Group, 'id' | 'name' | 'project_name'> & { topic?: { name?: string | null } | null },
    review: GroupReview | undefined,
    milestone: ReviewMilestoneContext | null,
  ) {
    const warnings = this.buildReviewWarnings(review, milestone);
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
      scores: {
        task_progress_score: review?.task_progress_score ?? null,
        commit_contribution_score: review?.commit_contribution_score ?? null,
        review_milestone_score: review?.review_milestone_score ?? null,
        total_score: review ? Number(totalScore.toFixed(2)) : null,
      },
      lecturer_note: review?.lecturer_note ?? null,
      snapshot: {
        task_total: review?.snapshot_task_total ?? 0,
        task_done: review?.snapshot_task_done ?? 0,
        commit_total: review?.snapshot_commit_total ?? null,
        commit_contributors: review?.snapshot_commit_contributors ?? null,
        repository: review?.snapshot_repository ?? null,
        captured_at: review?.snapshot_captured_at ?? null,
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

  private async captureReviewSnapshot(
    group: Pick<Group, 'id'>,
  ): Promise<{
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
      Role.ADMIN;
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
