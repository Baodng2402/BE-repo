import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  AuthProvider,
  ReviewMilestoneCode,
  ReviewProblemStatus,
  ReviewScoringFormula,
  ReviewSessionStatus,
  Role,
  SemesterStatus,
} from '../../common/enums';
import {
  Class,
  ClassCheckpoint,
  ClassMembership,
  ExaminerAssignment,
  Group,
  GroupMembership,
  GroupRepository,
  GroupReview,
  ImportBatch,
  ImportRowLog,
  ReviewSession,
  ReviewSessionAuditLog,
  Semester,
  SemesterWeekAuditLog,
  Task,
  TeachingAssignment,
  User,
} from '../../entities';
import { ClassCheckpointService } from '../class/class-checkpoint.service';
import { GithubService } from '../github/github.service';
import { SemesterService } from './semester.service';

function createMockRepository() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
  };
}

describe('SemesterService', () => {
  let service: SemesterService;
  let semesterRepo: ReturnType<typeof createMockRepository>;
  let batchRepo: ReturnType<typeof createMockRepository>;
  let rowLogRepo: ReturnType<typeof createMockRepository>;
  let classRepo: ReturnType<typeof createMockRepository>;
  let classMembershipRepo: ReturnType<typeof createMockRepository>;
  let teachingAssignmentRepo: ReturnType<typeof createMockRepository>;
  let examinerAssignmentRepo: ReturnType<typeof createMockRepository>;
  let groupRepo: ReturnType<typeof createMockRepository>;
  let groupMembershipRepo: ReturnType<typeof createMockRepository>;
  let groupRepoLinkRepo: ReturnType<typeof createMockRepository>;
  let groupReviewRepo: ReturnType<typeof createMockRepository>;
  let reviewSessionRepo: ReturnType<typeof createMockRepository>;
  let reviewSessionAuditLogRepo: ReturnType<typeof createMockRepository>;
  let taskRepo: ReturnType<typeof createMockRepository>;
  let weekAuditRepo: ReturnType<typeof createMockRepository>;
  let classCheckpointRepo: ReturnType<typeof createMockRepository>;
  let userRepo: ReturnType<typeof createMockRepository>;
  let configService: { get: jest.Mock };
  let classCheckpointService: { ensureCheckpointsExist: jest.Mock };
  let githubService: { getRepoCommits: jest.Mock };

  beforeEach(async () => {
    semesterRepo = createMockRepository();
    batchRepo = createMockRepository();
    rowLogRepo = createMockRepository();
    classRepo = createMockRepository();
    classMembershipRepo = createMockRepository();
    teachingAssignmentRepo = createMockRepository();
    examinerAssignmentRepo = createMockRepository();
    groupRepo = createMockRepository();
    groupMembershipRepo = createMockRepository();
    groupRepoLinkRepo = createMockRepository();
    groupReviewRepo = createMockRepository();
    reviewSessionRepo = createMockRepository();
    reviewSessionAuditLogRepo = createMockRepository();
    taskRepo = createMockRepository();
    weekAuditRepo = createMockRepository();
    classCheckpointRepo = createMockRepository();
    userRepo = createMockRepository();
    configService = { get: jest.fn() };
    classCheckpointService = { ensureCheckpointsExist: jest.fn() };
    githubService = { getRepoCommits: jest.fn() };

    classCheckpointRepo.find.mockResolvedValue([]);
    classCheckpointService.ensureCheckpointsExist.mockResolvedValue([
      {
        checkpoint_number: 1,
        deadline_week: 3,
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        description: null,
      },
      {
        checkpoint_number: 2,
        deadline_week: 8,
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        description: null,
      },
      {
        checkpoint_number: 3,
        deadline_week: 10,
        milestone_code: ReviewMilestoneCode.REVIEW_3,
        description: null,
      },
    ]);

    batchRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'batch-1',
      ...entity,
    }));
    rowLogRepo.save.mockImplementation(async (entity) => entity);
    classRepo.save.mockImplementation(async (entity) => {
      if (Array.isArray(entity)) {
        return entity.map((item, index) => ({
          id: item.id ?? `class-${index + 1}`,
          ...item,
        }));
      }

      return {
        id: entity.id ?? 'class-1',
        ...entity,
      };
    });
    userRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? `user-${entity.email}`,
      ...entity,
    }));
    classMembershipRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'membership-1',
      ...entity,
    }));
    teachingAssignmentRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'teaching-assignment-1',
      ...entity,
    }));
    examinerAssignmentRepo.save.mockImplementation(async (entity) => entity);
    weekAuditRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'audit-1',
      ...entity,
    }));
    groupReviewRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'review-1',
      ...entity,
    }));
    reviewSessionAuditLogRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'review-audit-1',
      ...entity,
    }));
    reviewSessionRepo.find.mockResolvedValue([]);
    groupMembershipRepo.find.mockResolvedValue([]);
    configService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'DEMO_WEEK_OVERRIDE_ENABLED':
          return 'true';
        case 'DEMO_WEEK_OVERRIDE_ALLOWED_ROLES':
          return 'ADMIN,LECTURER';
        default:
          return undefined;
      }
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemesterService,
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(Semester), useValue: semesterRepo },
        { provide: getRepositoryToken(ImportBatch), useValue: batchRepo },
        { provide: getRepositoryToken(ImportRowLog), useValue: rowLogRepo },
        { provide: getRepositoryToken(Class), useValue: classRepo },
        {
          provide: getRepositoryToken(ClassMembership),
          useValue: classMembershipRepo,
        },
        {
          provide: getRepositoryToken(TeachingAssignment),
          useValue: teachingAssignmentRepo,
        },
        {
          provide: getRepositoryToken(ExaminerAssignment),
          useValue: examinerAssignmentRepo,
        },
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: groupMembershipRepo,
        },
        {
          provide: getRepositoryToken(GroupRepository),
          useValue: groupRepoLinkRepo,
        },
        {
          provide: getRepositoryToken(GroupReview),
          useValue: groupReviewRepo,
        },
        {
          provide: getRepositoryToken(ReviewSession),
          useValue: reviewSessionRepo,
        },
        {
          provide: getRepositoryToken(ReviewSessionAuditLog),
          useValue: reviewSessionAuditLogRepo,
        },
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        {
          provide: getRepositoryToken(SemesterWeekAuditLog),
          useValue: weekAuditRepo,
        },
        {
          provide: getRepositoryToken(ClassCheckpoint),
          useValue: classCheckpointRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ClassCheckpointService, useValue: classCheckpointService },
        { provide: GithubService, useValue: githubService },
      ],
    }).compile();

    service = module.get<SemesterService>(SemesterService);
  });

  it('creates semester with uppercase code and rejects duplicates', async () => {
    semesterRepo.findOne.mockResolvedValueOnce(null);
    classRepo.find.mockResolvedValueOnce([]);
    userRepo.findOne.mockResolvedValueOnce(null);
    semesterRepo.save.mockImplementation(async (entity) => ({
      id: 'semester-1',
      ...entity,
    }));

    const result = await service.createSemester({
      code: 'sp26',
      name: 'Spring 2026',
      start_date: '2026-01-01',
      end_date: '2026-05-01',
      status: SemesterStatus.ACTIVE,
    });

    expect(result.code).toBe('SP26');
    expect(classRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SWP391-1001', semester: 'SP26' }),
        expect.objectContaining({ code: 'SWP391-1002', semester: 'SP26' }),
        expect.objectContaining({ code: 'SWP391-1003', semester: 'SP26' }),
      ]),
    );

    semesterRepo.findOne.mockResolvedValueOnce({ id: 'semester-2' });

    await expect(
      service.createSemester({
        code: 'sp26',
        name: 'Spring 2026',
        start_date: '2026-01-01',
        end_date: '2026-05-01',
        status: SemesterStatus.ACTIVE,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks creating an active semester when another active semester exists', async () => {
    semesterRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'semester-active',
      code: 'SP26',
      status: SemesterStatus.ACTIVE,
    });

    await expect(
      service.createSemester({
        code: 'fa26',
        name: 'Fall 2026',
        start_date: '2026-09-01',
        end_date: '2026-12-31',
        status: SemesterStatus.ACTIVE,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks updating an upcoming semester to active when another active semester exists', async () => {
    semesterRepo.findOne
      .mockResolvedValueOnce({
        id: 'semester-upcoming',
        code: 'FA26',
        name: 'Fall 2026',
        status: SemesterStatus.UPCOMING,
      })
      .mockResolvedValueOnce({
        id: 'semester-active',
        code: 'SP26',
        status: SemesterStatus.ACTIVE,
      });

    await expect(
      service.updateSemester('semester-upcoming', {
        status: SemesterStatus.ACTIVE,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns active semester as current semester', async () => {
    semesterRepo.findOne
      .mockResolvedValueOnce({
        id: 'semester-active',
        code: 'SP26',
        status: SemesterStatus.ACTIVE,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await service.getCurrentSemester();

    expect(result).toMatchObject({
      id: 'semester-active',
      status: SemesterStatus.ACTIVE,
    });
    expect(semesterRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('creates a semester-scoped class without assigning a lecturer', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 1,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.findOne.mockResolvedValueOnce(null);
    classRepo.save.mockResolvedValue({
      id: 'class-9',
      code: 'SWP391-1009',
      name: 'SWP391 1009',
      semester: 'SP26',
      lecturer_id: null,
      lecturer: null,
      enrollment_key: 'ABCD1234',
    });

    const result = await service.createSemesterClass('semester-1', {
      code: 'swp391-1009',
      name: 'SWP391 1009',
    });

    expect(result).toMatchObject({
      id: 'class-9',
      code: 'SWP391-1009',
      lecturer_id: null,
    });
  });

  it('blocks deleting a class that still has semester data attached', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 1,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.findOne.mockResolvedValue({
      id: 'class-1',
      code: 'SWP391-1001',
      name: 'SWP391 1001',
      semester: 'SP26',
    });
    classMembershipRepo.count.mockResolvedValue(1);
    groupRepo.count.mockResolvedValue(0);
    teachingAssignmentRepo.findOne.mockResolvedValue(null);
    examinerAssignmentRepo.count.mockResolvedValue(0);

    await expect(
      service.deleteSemesterClass('semester-1', 'class-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('falls back to upcoming or latest semester when no active semester exists', async () => {
    semesterRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'semester-upcoming',
        code: 'FA26',
        status: SemesterStatus.UPCOMING,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const upcoming = await service.getCurrentSemester();

    expect(upcoming).toMatchObject({
      id: 'semester-upcoming',
      status: SemesterStatus.UPCOMING,
    });

    semesterRepo.findOne.mockReset();
    semesterRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'semester-latest',
        code: 'SP25',
        status: SemesterStatus.CLOSED,
      });

    const latest = await service.getCurrentSemester();

    expect(latest).toMatchObject({
      id: 'semester-latest',
      status: SemesterStatus.CLOSED,
    });
  });

  it('sets current week and records an audit log when demo override is enabled', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 1,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    semesterRepo.save.mockImplementation(async (entity) => entity);

    const result = await service.setCurrentWeek(
      'semester-1',
      2,
      'admin-1',
      Role.ADMIN,
    );

    expect(result.audit_recorded).toBe(true);
    expect(result.semester.current_week).toBe(2);
    expect(weekAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        semester_id: 'semester-1',
        actor_user_id: 'admin-1',
        previous_week: 1,
        new_week: 2,
      }),
    );
  });

  it('returns lecturer compliance summary for week 1 and week 2 gates', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 2,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        max_students_per_group: 6,
      },
    ]);
    classMembershipRepo.find.mockResolvedValue([
      { class_id: 'class-1', user_id: 'student-1' },
      { class_id: 'class-1', user_id: 'student-2' },
    ]);
    groupRepo.find.mockResolvedValue([
      {
        id: 'group-1',
        class_id: 'class-1',
        name: 'Group 1',
        topic_id: 'topic-1',
        project_name: 'Topic One',
        topic: { id: 'topic-1', name: 'Topic One' },
      },
      {
        id: 'group-2',
        class_id: 'class-1',
        name: 'Group 2',
        topic_id: null,
        project_name: null,
        topic: null,
      },
    ]);
    groupMembershipRepo.find.mockResolvedValue([
      { group_id: 'group-1', user_id: 'student-1' },
    ]);

    const result = await service.getLecturerComplianceSummary(
      'lecturer-1',
      Role.LECTURER,
    );

    expect(result.summary.classes_total).toBe(1);
    expect(result.summary.students_without_group_total).toBe(1);
    expect(result.summary.groups_without_topic_total).toBe(1);
    expect(result.classes[0]).toMatchObject({
      class_id: 'class-1',
      week1_status: 'FAIL',
      week2_status: 'FAIL',
    });
    expect(result.classes[0].groups[0]).toMatchObject({
      group_id: 'group-1',
      week1_status: 'PASS',
      week2_status: 'PASS',
    });
    expect(result.classes[0].groups[1]).toMatchObject({
      group_id: 'group-2',
      week1_status: 'FAIL',
      week2_status: 'FAIL',
    });
  });

  it('returns student warnings for missing group and unfinalized topic', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 2,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classMembershipRepo.find.mockResolvedValue([
      {
        class: {
          id: 'class-1',
          code: 'SWP391',
          name: 'Software Project',
          semester: 'SP26',
        },
      },
      {
        class: {
          id: 'class-2',
          code: 'SWR302',
          name: 'Mobile Project',
          semester: 'SP26',
        },
      },
    ]);
    groupMembershipRepo.find.mockResolvedValue([
      {
        group: {
          id: 'group-1',
          class_id: 'class-1',
          name: 'Group 1',
          topic_id: null,
          project_name: null,
          topic: null,
          class: {
            id: 'class-1',
            semester: 'SP26',
          },
        },
      },
    ]);

    const result = await service.getStudentWeeklyWarnings('student-1');

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WEEK2_TOPIC_NOT_FINALIZED' }),
        expect.objectContaining({
          code: 'WEEK1_NO_GROUP',
          class_id: 'class-2',
        }),
      ]),
    );
  });

  it('returns an empty valid payload when student has no class in the current semester', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 2,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classMembershipRepo.find.mockResolvedValue([
      {
        class: {
          id: 'class-old',
          code: 'OLD101',
          name: 'Old Class',
          semester: 'SP25',
        },
      },
    ]);

    const result = await service.getStudentWeeklyWarnings('student-1');

    expect(result.semester?.code).toBe('SP26');
    expect(result.warnings).toEqual([]);
    expect(result.classes).toEqual([]);
  });

  it('degrades safely when warning relations are null or orphaned', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 2,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classMembershipRepo.find.mockResolvedValue([
      { class: null },
      {
        class: {
          id: 'class-1',
          code: 'SWP391',
          name: 'Software Project',
          semester: 'SP26',
        },
      },
    ]);
    groupMembershipRepo.find.mockResolvedValue([
      { group: null },
      {
        group: {
          id: 'group-1',
          class_id: 'class-1',
          name: 'Group 1',
          topic: null,
          project_name: null,
          class: null,
        },
      },
    ]);

    const result = await service.getStudentWeeklyWarnings(
      'student-1',
      Role.STUDENT,
    );

    expect(result.semester?.code).toBe('SP26');
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({
      class_id: 'class-1',
      has_group: false,
      week1_status: 'FAIL',
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WEEK1_NO_GROUP' }),
      ]),
    );
  });

  it('degrades to an empty payload when the warning path throws unexpectedly', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 2,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classMembershipRepo.find.mockRejectedValue(new Error('broken relation'));

    const result = await service.getStudentWeeklyWarnings(
      'student-1',
      Role.STUDENT,
    );

    expect(result).toEqual({
      semester: null,
      warnings: [],
      classes: [],
    });
  });

  it('maps current week to grouped review milestone windows', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 7,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });

    const result = await service.getCurrentReviewMilestone();

    expect(result.semester?.current_week).toBe(7);
    expect(result.milestone).toEqual({
      code: ReviewMilestoneCode.REVIEW_2,
      label: 'Review 2',
      week_start: 4,
      week_end: 8,
    });
  });

  it('maps the final milestone to final score', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 11,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });

    const result = await service.getCurrentReviewMilestone();

    expect(result.milestone).toEqual({
      code: ReviewMilestoneCode.FINAL_SCORE,
      label: 'Final Score',
      week_start: 11,
      week_end: 12,
    });
  });

  it('upserts a lecturer group review with task and commit snapshot evidence', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 5,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      project_name: 'Project One',
      topic: null,
      class: {
        id: 'class-1',
        lecturer_id: 'lecturer-1',
      },
    });
    taskRepo.find.mockResolvedValue([
      { id: 'task-1', status: 'DONE' },
      { id: 'task-2', status: 'TODO' },
    ]);
    groupRepoLinkRepo.findOne
      .mockResolvedValueOnce({
        group_id: 'group-1',
        repo_owner: 'org',
        repo_name: 'repo',
        added_by_id: 'leader-1',
      })
      .mockResolvedValueOnce(null);
    githubService.getRepoCommits.mockResolvedValue([
      { author: 'alice' },
      { author: 'alice' },
      { author: 'bob' },
    ]);
    groupReviewRepo.findOne.mockResolvedValue(null);

    const result = await service.upsertCurrentGroupReview(
      'group-1',
      'lecturer-1',
      Role.LECTURER,
      {
        task_progress_score: 8,
        commit_contribution_score: 7,
        review_milestone_score: 9,
        lecturer_note: 'Good progress for checkpoint.',
      },
    );

    expect(groupReviewRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        snapshot_task_total: 2,
        snapshot_task_done: 1,
        snapshot_commit_total: 3,
        snapshot_commit_contributors: 2,
      }),
    );
    expect(result.group.review_status).toBe('REVIEWED');
    expect(result.group.scores.task_progress_score).toBe(8);
    expect(result.group.scores.commit_contribution_score).toBe(7);
    expect(result.group.scores.review_milestone_score).toBe(9);
    expect(result.group.scores.auto_score).toBeCloseTo(5.67, 2);
    expect(result.group.scores.final_score).toBeCloseTo(5.67, 2);
    expect(result.group.scores.total_score).toBeCloseTo(5.67, 2);
    expect(result.group.snapshot.repository).toBe('org/repo');
  });

  it('auto-generates draft scores from snapshot evidence when scores are omitted', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 7,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      project_name: 'Project One',
      topic: null,
      class: {
        id: 'class-1',
        lecturer_id: 'lecturer-1',
      },
    });
    taskRepo.find.mockResolvedValue([
      { id: 'task-1', status: 'DONE' },
      { id: 'task-2', status: 'DONE' },
      { id: 'task-3', status: 'TODO' },
    ]);
    groupRepoLinkRepo.findOne
      .mockResolvedValueOnce({
        group_id: 'group-1',
        repo_owner: 'org',
        repo_name: 'repo',
        added_by_id: 'leader-1',
      })
      .mockResolvedValueOnce(null);
    githubService.getRepoCommits.mockResolvedValue([
      { author: 'alice' },
      { author: 'alice' },
      { author: 'bob' },
      { author: 'charlie' },
    ]);
    groupReviewRepo.findOne.mockResolvedValue(null);

    const result = await service.upsertCurrentGroupReview(
      'group-1',
      'lecturer-1',
      Role.LECTURER,
      {
        lecturer_note: 'Auto draft from evidence',
      },
    );

    expect(result.group.scores.task_progress_score).toBe(10);
    expect(result.group.scores.commit_contribution_score).toBe(3.65);
    expect(result.group.scores.review_milestone_score).toBe(10);
    expect(result.group.scores.auto_score).toBeCloseTo(4.55, 2);
    expect(result.group.scores.final_score).toBeCloseTo(4.55, 2);
    expect(result.group.scores.total_score).toBeCloseTo(4.55, 2);
  });

  it('returns lecturer review summary with missing evidence warnings', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 9,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
      },
    ]);
    groupRepo.find.mockResolvedValue([
      {
        id: 'group-1',
        class_id: 'class-1',
        name: 'Group 1',
        project_name: null,
        topic: null,
      },
    ]);
    groupReviewRepo.find.mockResolvedValue([
      {
        id: 'review-1',
        group_id: 'group-1',
        milestone_code: ReviewMilestoneCode.REVIEW_3,
        task_progress_score: 7,
        commit_contribution_score: 6,
        review_milestone_score: 8,
        lecturer_note: 'Need more commit activity.',
        snapshot_task_total: 0,
        snapshot_task_done: 0,
        snapshot_commit_total: null,
        snapshot_commit_contributors: null,
        snapshot_repository: null,
        snapshot_captured_at: new Date('2026-03-25T00:00:00.000Z'),
      },
    ]);

    const result = await service.getLecturerReviewSummary(
      'lecturer-1',
      Role.LECTURER,
    );

    expect(result.classes[0].active_checkpoint?.code).toBe(
      ReviewMilestoneCode.REVIEW_3,
    );
    expect(result.summary.groups_missing_task_evidence).toBe(1);
    expect(result.summary.groups_missing_commit_evidence).toBe(1);
    expect(result.classes[0].groups[0].warnings).toEqual(
      expect.arrayContaining(['NO_TASK_EVIDENCE', 'NO_COMMIT_EVIDENCE']),
    );
  });

  it('returns student review status for joined groups in the active semester', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 3,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupMembershipRepo.find.mockResolvedValue([
      {
        group: {
          id: 'group-1',
          class_id: 'class-1',
          name: 'Group 1',
          project_name: 'Project One',
          topic: null,
          class: {
            id: 'class-1',
            code: 'SWP391',
            name: 'Software Project',
            semester: 'SP26',
          },
        },
      },
    ]);
    groupReviewRepo.find.mockResolvedValue([
      {
        id: 'review-1',
        group_id: 'group-1',
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        task_progress_score: 8,
        commit_contribution_score: 7,
        review_milestone_score: 9,
        lecturer_note: 'Solid first review.',
        snapshot_task_total: 3,
        snapshot_task_done: 2,
        snapshot_commit_total: 6,
        snapshot_commit_contributors: 2,
        snapshot_repository: 'org/repo',
        snapshot_captured_at: new Date('2026-03-25T00:00:00.000Z'),
      },
    ]);

    const result = await service.getStudentReviewStatus('student-1');

    expect(result.groups[0].milestone?.code).toBe(ReviewMilestoneCode.REVIEW_1);
    expect(result.groups[0]).toMatchObject({
      class_id: 'class-1',
      group_id: 'group-1',
      review_status: 'REVIEWED',
    });
    expect(result.groups[0].warnings).toHaveLength(0);
  });

  it('creates one review session per group per day and blocks duplicates', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 4,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      class: {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    });
    reviewSessionRepo.findOne.mockResolvedValue(null);
    reviewSessionRepo.save.mockImplementation(async (entity) => ({
      id: 'session-1',
      ...entity,
    }));

    const created = await service.createReviewSession(
      'group-1',
      'lecturer-1',
      Role.LECTURER,
      {
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        review_date: '2026-03-12T09:00:00.000Z',
        title: 'Review 1 prep',
        current_problems: [],
      },
    );

    expect(created.review_day).toBe('2026-03-12');
    expect(created.status).toBe(ReviewSessionStatus.SCHEDULED);
    expect(reviewSessionAuditLogRepo.save).toHaveBeenCalled();

    reviewSessionRepo.findOne.mockResolvedValueOnce({
      id: 'session-existing',
      group_id: 'group-1',
      review_day: '2026-03-12',
      deleted_at: null,
    });

    await expect(
      service.createReviewSession('group-1', 'lecturer-1', Role.LECTURER, {
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        review_date: '2026-03-12T15:00:00.000Z',
        title: 'Duplicate same-day review',
        current_problems: [],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('auto-carries not-done problems from the previous review session', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 4,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      class: {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    });
    groupMembershipRepo.find.mockResolvedValue([
      {
        group_id: 'group-1',
        user_id: 'student-1',
        left_at: null,
        user: { id: 'student-1', full_name: 'Nguyen Van A', email: 'a@fpt.edu.vn' },
      },
      {
        group_id: 'group-1',
        user_id: 'student-2',
        left_at: null,
        user: { id: 'student-2', full_name: 'Tran Thi B', email: 'b@fpt.edu.vn' },
      },
    ]);
    reviewSessionRepo.find.mockResolvedValue([
      {
        id: 'session-prev',
        semester_id: 'semester-1',
        group_id: 'group-1',
        review_date: new Date('2026-03-10T09:00:00.000Z'),
        current_problems: [
          {
            id: 'problem-1',
            title: 'Jira permissions still blocked',
            status: ReviewProblemStatus.NOT_DONE,
            note: 'Need admin scope fix',
          },
          {
            id: 'problem-2',
            title: 'Old resolved blocker',
            status: ReviewProblemStatus.DONE,
            note: 'Already resolved',
          },
        ],
      },
    ]);
    reviewSessionRepo.findOne.mockResolvedValue(null);
    reviewSessionRepo.save.mockImplementation(async (entity) => ({
      id: 'session-new',
      ...entity,
    }));

    const created = await service.createReviewSession(
      'group-1',
      'lecturer-1',
      Role.LECTURER,
      {
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        review_date: '2026-03-12T09:00:00.000Z',
        title: 'Follow-up review',
        current_problems: [
          {
            title: 'Need deployment rehearsal',
            status: ReviewProblemStatus.NOT_DONE,
            note: 'Schedule before demo',
          },
        ],
        attendance_records: [
          { user_id: 'student-1', present: true },
          { user_id: 'student-2', present: false },
        ],
      },
    );

    expect(created.previous_session_id).toBe('session-prev');
    expect(created.current_problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Jira permissions still blocked' }),
        expect.objectContaining({ title: 'Need deployment rehearsal' }),
      ]),
    );
    expect(created.current_problems).toHaveLength(2);
    expect(created.attendance_ratio).toBe(0.5);
    expect(created.attendance_records).toHaveLength(2);
  });

  it('uses per-student attendance records in checkpoint scoring metrics', async () => {
    semesterRepo.findOne.mockResolvedValueOnce({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 7,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      project_name: 'Project One',
      topic: null,
      class: {
        id: 'class-1',
        lecturer_id: 'lecturer-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
      },
    });
    taskRepo.find.mockResolvedValue([
      { id: 'task-1', status: 'DONE', due_at: null },
      { id: 'task-2', status: 'TODO', due_at: null },
    ]);
    groupRepoLinkRepo.findOne
      .mockResolvedValueOnce({
        group_id: 'group-1',
        repo_owner: 'org',
        repo_name: 'repo',
        added_by_id: 'leader-1',
      })
      .mockResolvedValueOnce(null);
    githubService.getRepoCommits.mockResolvedValue([
      { author: 'alice' },
      { author: 'bob' },
    ]);
    reviewSessionRepo.find.mockResolvedValue([
      {
        id: 'session-1',
        group_id: 'group-1',
        review_date: new Date('2026-03-20T09:00:00.000Z'),
        review_day: '2026-03-20',
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        status: ReviewSessionStatus.COMPLETED,
        title: 'Attendance check',
        lecturer_note: null,
        what_done_since_last_review: null,
        next_plan_until_next_review: null,
        previous_problem_followup: null,
        current_problems: [],
        attendance_ratio: null,
        attendance_records: [
          { user_id: 'student-1', user_name: 'A', present: true },
          { user_id: 'student-2', user_name: 'B', present: true },
          { user_id: 'student-3', user_name: 'C', present: false },
        ],
        previous_session_id: null,
      },
    ]);
    groupReviewRepo.findOne.mockResolvedValue(null);

    const result = await service.upsertCurrentGroupReview(
      'group-1',
      'lecturer-1',
      Role.LECTURER,
      {
        scoring_formula: ReviewScoringFormula.ATTENDANCE_ONLY,
      },
    );

    expect(result.group.scoring?.metrics.attendance_ratio).toBeCloseTo(0.67, 2);
    expect(result.group.scores.auto_score).toBeCloseTo(6.7, 1);
  });

  it('rejects not-done problems without note and requires override reason for final score override', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 7,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      project_name: 'Project One',
      topic: null,
      class: {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    });
    reviewSessionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createReviewSession('group-1', 'lecturer-1', Role.LECTURER, {
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        review_date: '2026-03-20T09:00:00.000Z',
        title: 'Review with open problem',
        current_problems: [
          {
            title: 'CI still failing',
            status: ReviewProblemStatus.NOT_DONE,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    taskRepo.find.mockResolvedValue([
      { id: 'task-1', status: 'DONE', due_at: null },
      { id: 'task-2', status: 'TODO', due_at: null },
    ]);
    groupRepoLinkRepo.findOne
      .mockResolvedValueOnce({
        group_id: 'group-1',
        repo_owner: 'org',
        repo_name: 'repo',
        added_by_id: 'leader-1',
      })
      .mockResolvedValueOnce(null);
    githubService.getRepoCommits.mockResolvedValue([
      { author: 'alice' },
      { author: 'bob' },
    ]);
    reviewSessionRepo.find.mockResolvedValue([
      {
        id: 'session-1',
        group_id: 'group-1',
        current_problems: [
          {
            id: 'problem-1',
            title: 'CI still failing',
            status: ReviewProblemStatus.DONE,
            note: 'Resolved yesterday',
          },
        ],
        attendance_ratio: 0.8,
      },
    ]);
    groupReviewRepo.findOne.mockResolvedValue(null);

    await expect(
      service.upsertCurrentGroupReview(
        'group-1',
        'lecturer-1',
        Role.LECTURER,
        {
          scoring_formula: ReviewScoringFormula.ATTENDANCE_ONLY,
          final_score: 9.5,
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows students to read review sessions but not modify them', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 5,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      class_id: 'class-1',
      name: 'Group 1',
      class: {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
      topic: null,
    });
    groupMembershipRepo.findOne.mockResolvedValue({
      id: 'membership-1',
      user_id: 'student-1',
      group_id: 'group-1',
      left_at: null,
    });
    reviewSessionRepo.find.mockResolvedValue([
      {
        id: 'session-1',
        group_id: 'group-1',
        review_day: '2026-03-25',
        review_date: new Date('2026-03-25T09:00:00.000Z'),
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        status: ReviewSessionStatus.COMPLETED,
        title: 'Review 2 checkpoint prep',
        lecturer_note: 'Need tighter delivery on backlog cleanup',
        what_done_since_last_review: 'Closed task sync bugs',
        next_plan_until_next_review: 'Prepare checkpoint demo',
        previous_problem_followup: 'Resolved CI outage',
        attendance_ratio: 0.9,
        current_problems: [],
      },
    ]);

    const readResult = await service.listGroupReviewSessions(
      'group-1',
      'student-1',
      Role.STUDENT,
    );

    expect(readResult.sessions).toHaveLength(1);

    await expect(
      service.createReviewSession('group-1', 'student-1', Role.STUDENT, {
        milestone_code: ReviewMilestoneCode.REVIEW_2,
        review_date: '2026-03-26T09:00:00.000Z',
        title: 'Student should not create this',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks imports into closed semesters', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.CLOSED,
    });

    await expect(
      service.processImport('semester-1', 'admin-1', 'file.xlsx', [], 'IMPORT'),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates a clean student workbook preview', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
    });
    userRepo.find.mockResolvedValue([]);
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    ]);

    const result = await service.processImport(
      'semester-1',
      'admin-1',
      'import.xlsx',
      [
        {
          row_number: 2,
          semester_code: 'SP26',
          email: 'student1@fpt.edu.vn',
          full_name: 'Student One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0001',
        },
        {
          row_number: 3,
          semester_code: 'SP26',
          email: 'student2@fpt.edu.vn',
          full_name: 'Student Two',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0002',
        },
      ],
      'VALIDATE',
    );

    expect(result.readyForImport).toBe(true);
    expect(result.summary.rows.success).toBe(2);
    expect(result.summary.rows.failed).toBe(0);
    expect(result.summary.classes.created).toBe(0);
    expect(result.summary.classes.updated).toBe(1);
    expect(result.summary.lecturers.created).toBe(0);
    expect(result.summary.students.created).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('supports partial success and logs failed rows during import', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
    });
    userRepo.find.mockResolvedValue([]);
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    ]);
    classMembershipRepo.findOne.mockResolvedValue(null);

    const result = await service.processImport(
      'semester-1',
      'admin-1',
      'import.xlsx',
      [
        {
          row_number: 2,
          semester_code: 'SP25',
          email: 'wrong-semester@fpt.edu.vn',
          full_name: 'Wrong Semester',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0002',
        },
        {
          row_number: 3,
          semester_code: 'SP26',
          email: 'student@fpt.edu.vn',
          full_name: 'Student One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0003',
        },
      ],
      'IMPORT',
    );

    expect(result.readyForImport).toBe(false);
    expect(result.summary.rows.success).toBe(1);
    expect(result.summary.rows.failed).toBe(1);
    expect(result.summary.classes.created).toBe(0);
    expect(result.summary.classes.updated).toBe(1);
    expect(result.summary.enrollments.created).toBe(1);
    expect(groupRepo.insert).not.toHaveBeenCalled();
    expect(rowLogRepo.save).toHaveBeenCalled();
    expect(result.rows.some((row) => row.status === 'FAILED')).toBe(true);
  });

  it('imports optional lecturer rows and assigns them to classes', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
    });
    userRepo.find.mockResolvedValue([]);
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: null,
        lecturer: null,
      },
    ]);

    const result = await service.processImport(
      'semester-1',
      'admin-1',
      'import.xlsx',
      [
        {
          row_number: 2,
          semester_code: 'SP26',
          role: 'LECTURER',
          email: 'lecturer@fpt.edu.vn',
          full_name: 'Lecturer One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: '',
        },
      ],
      'IMPORT',
    );

    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer One',
        role: Role.LECTURER,
      }),
    );
    expect(classRepo.update).toHaveBeenCalledWith(
      { id: 'class-1' },
      { lecturer_id: 'user-lecturer@fpt.edu.vn' },
    );
    expect(result.summary.lecturers.created).toBe(1);
    expect(result.summary.rows.success).toBe(1);
    expect(result.rows[0].message).toContain('Lecturer assigned');
  });

  it('rejects non-student identities in student rows', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
    });
    userRepo.find.mockResolvedValue([
      {
        id: 'user-lecturer',
        email: 'student@fpt.edu.vn',
        role: Role.LECTURER,
        primary_provider: AuthProvider.EMAIL,
      },
    ]);
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
      },
    ]);

    const result = await service.processImport(
      'semester-1',
      'admin-1',
      'import.xlsx',
      [
        {
          row_number: 2,
          semester_code: 'SP26',
          email: 'student@fpt.edu.vn',
          full_name: 'Wrong Role',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0004',
        },
      ],
      'IMPORT',
    );

    expect(result.summary.rows.failed).toBe(1);
    expect(result.rows.find((row) => row.row_number === 2)?.message).toContain(
      'non-student account',
    );
  });

  it('returns semester roster with lecturer, student, and class summary', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 10,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
        lecturer: { id: 'lecturer-1', full_name: 'Lecturer One' },
      },
    ]);
    teachingAssignmentRepo.find.mockResolvedValue([]);
    examinerAssignmentRepo.find.mockResolvedValue([]);
    classMembershipRepo.find.mockResolvedValue([
      {
        class_id: 'class-1',
        user_id: 'student-1',
        class: { id: 'class-1', code: 'SWP391', name: 'Software Project' },
        user: {
          id: 'student-1',
          email: 'student@fpt.edu.vn',
          full_name: 'Student One',
          student_id: 'SE123',
        },
      },
    ]);
    userRepo.find.mockResolvedValue([
      {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer One',
        role: Role.LECTURER,
      },
    ]);

    const result = await service.getSemesterRoster('semester-1');

    expect(result.summary.classes_total).toBe(1);
    expect(result.summary.students_total).toBe(1);
    expect(result.classes[0].student_count).toBe(1);
    expect(result.lecturers[0].teaching_classes).toHaveLength(1);
  });

  it('reassigns lecturer teaching assignments in bulk', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 8,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.findOne.mockResolvedValue({
      id: 'class-1',
      code: 'SWP391',
      name: 'Software Project',
      semester: 'SP26',
      lecturer_id: 'lecturer-old',
    });
    userRepo.findOne.mockResolvedValue({
      id: 'lecturer-1',
      email: 'lecturer@fpt.edu.vn',
      role: Role.LECTURER,
    });
    teachingAssignmentRepo.findOne.mockResolvedValue(null);
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
        lecturer: { id: 'lecturer-1', full_name: 'Lecturer One' },
      },
    ]);
    teachingAssignmentRepo.find.mockResolvedValue([
      {
        id: 'ta-1',
        class_id: 'class-1',
        lecturer_id: 'lecturer-1',
        lecturer: { id: 'lecturer-1', full_name: 'Lecturer One' },
      },
    ]);
    examinerAssignmentRepo.find.mockResolvedValue([]);
    classMembershipRepo.find.mockResolvedValue([]);
    userRepo.find.mockResolvedValue([
      {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer One',
        role: Role.LECTURER,
      },
    ]);

    const result = await service.bulkReassignTeachingAssignments(
      'semester-1',
      'admin-1',
      {
        assignments: [{ class_id: 'class-1', lecturer_id: 'lecturer-1' }],
      },
    );

    expect(classRepo.update).toHaveBeenCalledWith(
      { id: 'class-1' },
      { lecturer_id: 'lecturer-1' },
    );
    expect(result.classes[0].lecturer_id).toBe('lecturer-1');
  });

  it('blocks examiner assignment before week 10', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 9,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });

    await expect(
      service.bulkAssignExaminers('semester-1', 'admin-1', {
        assignments: [{ class_id: 'class-1', lecturer_ids: ['lecturer-1'] }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects examiner assignment when lecturer teaches the same class', async () => {
    semesterRepo.findOne.mockResolvedValue({
      id: 'semester-1',
      code: 'SP26',
      name: 'Spring 2026',
      status: SemesterStatus.ACTIVE,
      current_week: 10,
      start_date: '2026-01-01',
      end_date: '2026-05-01',
    });
    classRepo.find.mockResolvedValue([
      {
        id: 'class-1',
        code: 'SWP391',
        name: 'Software Project',
        semester: 'SP26',
        lecturer_id: 'lecturer-1',
        lecturer: { id: 'lecturer-1', full_name: 'Lecturer One' },
      },
    ]);
    userRepo.find.mockResolvedValue([
      {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer One',
        role: Role.LECTURER,
      },
    ]);

    await expect(
      service.bulkAssignExaminers('semester-1', 'admin-1', {
        assignments: [{ class_id: 'class-1', lecturer_ids: ['lecturer-1'] }],
      }),
    ).rejects.toThrow(ConflictException);
  });
});
