import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  AuthProvider,
  ReviewMilestoneCode,
  Role,
  SemesterStatus,
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
  let taskRepo: ReturnType<typeof createMockRepository>;
  let weekAuditRepo: ReturnType<typeof createMockRepository>;
  let userRepo: ReturnType<typeof createMockRepository>;
  let configService: { get: jest.Mock };
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
    taskRepo = createMockRepository();
    weekAuditRepo = createMockRepository();
    userRepo = createMockRepository();
    configService = { get: jest.fn() };
    githubService = { getRepoCommits: jest.fn() };

    batchRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'batch-1',
      ...entity,
    }));
    rowLogRepo.save.mockImplementation(async (entity) => entity);
    classRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'class-1',
      ...entity,
    }));
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
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        {
          provide: getRepositoryToken(SemesterWeekAuditLog),
          useValue: weekAuditRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: GithubService, useValue: githubService },
      ],
    }).compile();

    service = module.get<SemesterService>(SemesterService);
  });

  it('creates semester with uppercase code and rejects duplicates', async () => {
    semesterRepo.findOne.mockResolvedValueOnce(null);
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
      week_start: 7,
      week_end: 8,
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
        milestone_code: ReviewMilestoneCode.PROGRESS_TRACKING,
        snapshot_task_total: 2,
        snapshot_task_done: 1,
        snapshot_commit_total: 3,
        snapshot_commit_contributors: 2,
      }),
    );
    expect(result.group.review_status).toBe('REVIEWED');
    expect(result.group.scores.total_score).toBe(24);
    expect(result.group.snapshot.repository).toBe('org/repo');
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

    expect(result.milestone?.code).toBe(ReviewMilestoneCode.REVIEW_3);
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
      current_week: 4,
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

    expect(result.milestone?.code).toBe(ReviewMilestoneCode.REVIEW_1);
    expect(result.groups[0]).toMatchObject({
      class_id: 'class-1',
      group_id: 'group-1',
      review_status: 'REVIEWED',
    });
    expect(result.groups[0].warnings).toHaveLength(0);
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
    classRepo.find.mockResolvedValue([]);

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
    expect(result.summary.classes.created).toBe(1);
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
    classRepo.find.mockResolvedValue([]);
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
    expect(result.summary.classes.created).toBe(1);
    expect(result.summary.enrollments.created).toBe(1);
    expect(groupRepo.insert).toHaveBeenCalledTimes(1);
    expect(rowLogRepo.save).toHaveBeenCalled();
    expect(result.rows.some((row) => row.status === 'FAILED')).toBe(true);
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
    classRepo.find.mockResolvedValue([]);

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
