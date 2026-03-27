import { Test, TestingModule } from '@nestjs/testing';
import { SemesterController } from './semester.controller';
import { SemesterService } from './semester.service';

describe('SemesterController', () => {
  let controller: SemesterController;
  let semesterService: Record<string, jest.Mock>;

  beforeEach(async () => {
    semesterService = {
      listSemesters: jest.fn(),
      createSemester: jest.fn(),
      updateSemester: jest.fn(),
      getImportBatches: jest.fn(),
      processImport: jest.fn(),
      getSemesterRoster: jest.fn(),
      createSemesterLecturer: jest.fn(),
      updateSemesterLecturer: jest.fn(),
      deleteSemesterLecturer: jest.fn(),
      createSemesterStudent: jest.fn(),
      updateSemesterStudent: jest.fn(),
      deleteSemesterStudent: jest.fn(),
      bulkReassignTeachingAssignments: jest.fn(),
      getExaminerAssignments: jest.fn(),
      bulkAssignExaminers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SemesterController],
      providers: [{ provide: SemesterService, useValue: semesterService }],
    }).compile();

    controller = module.get(SemesterController);
  });

  it('delegates roster lookup', async () => {
    semesterService.getSemesterRoster.mockResolvedValue({ lecturers: [] });

    await controller.getSemesterRoster(
      '11111111-1111-1111-1111-111111111111',
    );

    expect(semesterService.getSemesterRoster).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('delegates bulk teaching reassignment with actor id', async () => {
    semesterService.bulkReassignTeachingAssignments.mockResolvedValue({
      classes: [],
    });

    await controller.bulkReassignTeachingAssignments(
      '11111111-1111-1111-1111-111111111111',
      { user: { id: 'admin-1' } } as any,
      {
        assignments: [
          {
            class_id: 'class-1',
            lecturer_id: 'lecturer-1',
          },
        ],
      },
    );

    expect(
      semesterService.bulkReassignTeachingAssignments,
    ).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'admin-1', {
      assignments: [{ class_id: 'class-1', lecturer_id: 'lecturer-1' }],
    });
  });

  it('delegates examiner assignment update with actor id', async () => {
    semesterService.bulkAssignExaminers.mockResolvedValue({
      classes: [],
    });

    await controller.bulkAssignExaminers(
      '11111111-1111-1111-1111-111111111111',
      { user: { id: 'admin-1' } } as any,
      {
        assignments: [
          {
            class_id: 'class-1',
            lecturer_ids: ['lecturer-2'],
          },
        ],
      },
    );

    expect(semesterService.bulkAssignExaminers).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'admin-1',
      { assignments: [{ class_id: 'class-1', lecturer_ids: ['lecturer-2'] }] },
    );
  });
});
