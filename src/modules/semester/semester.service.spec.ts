import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthProvider, Role, SemesterStatus } from '../../common/enums';
import {
  Class,
  ClassMembership,
  Group,
  ImportBatch,
  ImportRowLog,
  Semester,
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
  let userRepo: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    semesterRepo = createMockRepository();
    batchRepo = createMockRepository();
    rowLogRepo = createMockRepository();
    classRepo = createMockRepository();
    classMembershipRepo = createMockRepository();
    groupRepo = createMockRepository();
    userRepo = createMockRepository();

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemesterService,
        { provide: getRepositoryToken(Semester), useValue: semesterRepo },
        { provide: getRepositoryToken(ImportBatch), useValue: batchRepo },
        { provide: getRepositoryToken(ImportRowLog), useValue: rowLogRepo },
        { provide: getRepositoryToken(Class), useValue: classRepo },
        {
          provide: getRepositoryToken(ClassMembership),
          useValue: classMembershipRepo,
        },
        { provide: getRepositoryToken(Group), useValue: groupRepo },
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
