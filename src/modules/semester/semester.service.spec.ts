import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthProvider, Role, SemesterStatus } from '../../common/enums';
import {
  Class,
  ClassMembership,
  Group,
  GroupMembership,
  ImportBatch,
  ImportRowLog,
  Semester,
  SemesterWeekAuditLog,
  User,
} from '../../entities';
import { SemesterService } from './semester.service';

function createMockRepository() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
  };
}

describe('SemesterService', () => {
  let service: SemesterService;
  let semesterRepo: ReturnType<typeof createMockRepository>;
  let batchRepo: ReturnType<typeof createMockRepository>;
  let rowLogRepo: ReturnType<typeof createMockRepository>;
  let classRepo: ReturnType<typeof createMockRepository>;
  let classMembershipRepo: ReturnType<typeof createMockRepository>;
  let groupRepo: ReturnType<typeof createMockRepository>;
  let groupMembershipRepo: ReturnType<typeof createMockRepository>;
  let weekAuditRepo: ReturnType<typeof createMockRepository>;
  let userRepo: ReturnType<typeof createMockRepository>;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    semesterRepo = createMockRepository();
    batchRepo = createMockRepository();
    rowLogRepo = createMockRepository();
    classRepo = createMockRepository();
    classMembershipRepo = createMockRepository();
    groupRepo = createMockRepository();
    groupMembershipRepo = createMockRepository();
    weekAuditRepo = createMockRepository();
    userRepo = createMockRepository();
    configService = { get: jest.fn() };

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
    weekAuditRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'audit-1',
      ...entity,
    }));
    configService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'DEMO_WEEK_OVERRIDE_ENABLED':
          return 'true';
        case 'DEMO_WEEK_OVERRIDE_ALLOWED_ROLES':
          return 'ADMIN';
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
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: groupMembershipRepo,
        },
        {
          provide: getRepositoryToken(SemesterWeekAuditLog),
          useValue: weekAuditRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
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
        expect.objectContaining({ code: 'WEEK1_NO_GROUP', class_id: 'class-2' }),
      ]),
    );
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

  it('validates a clean lecturer + student workbook preview', async () => {
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
          role: 'LECTURER',
          email: 'lecturer@fpt.edu.vn',
          full_name: 'Lecturer One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: '',
        },
        {
          row_number: 3,
          semester_code: 'SP26',
          role: 'STUDENT',
          email: 'student@fpt.edu.vn',
          full_name: 'Student One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0001',
        },
      ],
      'VALIDATE',
    );

    expect(result.readyForImport).toBe(true);
    expect(result.summary.rows.success).toBe(2);
    expect(result.summary.rows.failed).toBe(0);
    expect(result.summary.classes.created).toBe(0);
    expect(result.summary.lecturers.created).toBe(1);
    expect(result.summary.students.created).toBe(1);
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
          semester_code: 'SP26',
          role: 'LECTURER',
          email: 'lecturer@fpt.edu.vn',
          full_name: 'Lecturer One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: '',
        },
        {
          row_number: 3,
          semester_code: 'SP25',
          role: 'STUDENT',
          email: 'wrong-semester@fpt.edu.vn',
          full_name: 'Wrong Semester',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: 'SE0002',
        },
        {
          row_number: 4,
          semester_code: 'SP26',
          role: 'STUDENT',
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
    expect(result.summary.rows.success).toBe(2);
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
          role: 'LECTURER',
          email: 'lecturer@fpt.edu.vn',
          full_name: 'Lecturer One',
          class_code: 'SWP391',
          class_name: 'Software Project',
          student_id: '',
        },
        {
          row_number: 3,
          semester_code: 'SP26',
          role: 'STUDENT',
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
    expect(result.rows.find((row) => row.row_number === 3)?.message).toContain(
      'non-student account',
    );
  });
});
