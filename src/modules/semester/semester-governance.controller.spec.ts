import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '../../common/enums';
import { SemesterGovernanceController } from './semester-governance.controller';
import { SemesterService } from './semester.service';

describe('SemesterGovernanceController', () => {
  let controller: SemesterGovernanceController;
  let semesterService: {
    getCurrentWeek: jest.Mock;
    getCurrentReviewMilestone: jest.Mock;
    setCurrentWeek: jest.Mock;
    getLecturerComplianceSummary: jest.Mock;
    getStudentWeeklyWarnings: jest.Mock;
    getLecturerReviewSummary: jest.Mock;
    getStudentReviewStatus: jest.Mock;
    upsertCurrentGroupReview: jest.Mock;
  };

  beforeEach(async () => {
    semesterService = {
      getCurrentWeek: jest.fn(),
      getCurrentReviewMilestone: jest.fn(),
      setCurrentWeek: jest.fn(),
      getLecturerComplianceSummary: jest.fn(),
      getStudentWeeklyWarnings: jest.fn(),
      getLecturerReviewSummary: jest.fn(),
      getStudentReviewStatus: jest.fn(),
      upsertCurrentGroupReview: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SemesterGovernanceController],
      providers: [{ provide: SemesterService, useValue: semesterService }],
    }).compile();

    controller = module.get<SemesterGovernanceController>(
      SemesterGovernanceController,
    );
  });

  it('delegates current review milestone lookup', async () => {
    semesterService.getCurrentReviewMilestone.mockResolvedValue({
      semester: { id: 'semester-1' },
      milestone: { code: 'REVIEW_1' },
    });

    await expect(controller.getCurrentReviewMilestone()).resolves.toEqual({
      semester: { id: 'semester-1' },
      milestone: { code: 'REVIEW_1' },
    });
    expect(semesterService.getCurrentReviewMilestone).toHaveBeenCalled();
  });

  it('delegates lecturer review summary lookup', async () => {
    semesterService.getLecturerReviewSummary.mockResolvedValue({
      classes: [],
    });

    await controller.getLecturerReviewSummary(
      {
        user: { id: 'lecturer-1', role: Role.LECTURER },
      } as any,
      'class-1',
    );

    expect(semesterService.getLecturerReviewSummary).toHaveBeenCalledWith(
      'lecturer-1',
      Role.LECTURER,
      'class-1',
    );
  });

  it('delegates student warning lookup with caller role', async () => {
    semesterService.getStudentWeeklyWarnings.mockResolvedValue({
      semester: null,
      warnings: [],
      classes: [],
    });

    await controller.getStudentWarnings({
      user: { id: 'student-1', role: Role.STUDENT },
    } as any);

    expect(semesterService.getStudentWeeklyWarnings).toHaveBeenCalledWith(
      'student-1',
      Role.STUDENT,
    );
  });

  it('delegates current group review upsert with caller identity', async () => {
    semesterService.upsertCurrentGroupReview.mockResolvedValue({
      group: { group_id: 'group-1' },
    });

    await controller.upsertCurrentGroupReview(
      'group-1',
      {
        user: { id: 'admin-1', role: Role.ADMIN },
      } as any,
      {
        task_progress_score: 8,
        lecturer_note: 'Checkpoint updated',
      },
    );

    expect(semesterService.upsertCurrentGroupReview).toHaveBeenCalledWith(
      'group-1',
      'admin-1',
      Role.ADMIN,
      {
        task_progress_score: 8,
        lecturer_note: 'Checkpoint updated',
      },
    );
  });
});
