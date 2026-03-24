import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Evaluation,
  EvaluationContribution,
  Group,
  GroupMembership,
  Role,
} from '../../entities';
import { EvaluationService } from './evaluation.service';

// ── Test fixtures ────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const THIRD_USER_ID = '33333333-3333-3333-3333-333333333333';
const GROUP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EVAL_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const NOW = new Date('2026-03-24T00:00:00Z');

const mockGroup = { id: GROUP_ID, name: 'Group Alpha' };

const mockMemberships = [
  {
    group_id: GROUP_ID,
    user_id: USER_ID,
    role_in_group: 'LEADER',
    left_at: null,
  },
  {
    group_id: GROUP_ID,
    user_id: OTHER_USER_ID,
    role_in_group: 'MEMBER',
    left_at: null,
  },
  {
    group_id: GROUP_ID,
    user_id: THIRD_USER_ID,
    role_in_group: 'MEMBER',
    left_at: null,
  },
];

const mockEvaluation = {
  id: EVAL_ID,
  group_id: GROUP_ID,
  title: 'Sprint 3',
  description: null,
  created_by_id: USER_ID,
  created_at: NOW,
  updated_at: NOW,
  createdBy: { id: USER_ID, full_name: 'Leader', avatar_url: null },
  contributions: [
    {
      user_id: USER_ID,
      contribution_percent: 40,
      note: null,
      user: { full_name: 'Leader', avatar_url: null },
    },
    {
      user_id: OTHER_USER_ID,
      contribution_percent: 35,
      note: null,
      user: { full_name: 'Member B', avatar_url: null },
    },
    {
      user_id: THIRD_USER_ID,
      contribution_percent: 25,
      note: null,
      user: { full_name: 'Member C', avatar_url: null },
    },
  ],
};

// ── Mock Repositories ───────────────────────────────────

function createMockRepo() {
  return {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn((entity) => entity),
    delete: jest.fn(),
  };
}

function createMockDataSource() {
  return {
    transaction: jest.fn((cb) => {
      const manager = {
        create: jest.fn((_Entity, data) => data),
        save: jest.fn((data) => {
          if (Array.isArray(data)) return data;
          return { ...data, id: EVAL_ID };
        }),
        delete: jest.fn(),
      };
      return cb(manager);
    }),
  };
}

// ── Tests ───────────────────────────────────────────────

describe('EvaluationService', () => {
  let service: EvaluationService;
  let evaluationRepo: ReturnType<typeof createMockRepo>;
  let contributionRepo: ReturnType<typeof createMockRepo>;
  let groupRepo: ReturnType<typeof createMockRepo>;
  let membershipRepo: ReturnType<typeof createMockRepo>;
  let dataSource: ReturnType<typeof createMockDataSource>;

  beforeEach(async () => {
    evaluationRepo = createMockRepo();
    contributionRepo = createMockRepo();
    groupRepo = createMockRepo();
    membershipRepo = createMockRepo();
    dataSource = createMockDataSource();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: getRepositoryToken(Evaluation), useValue: evaluationRepo },
        {
          provide: getRepositoryToken(EvaluationContribution),
          useValue: contributionRepo,
        },
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: membershipRepo,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<EvaluationService>(EvaluationService);
  });

  // ── createEvaluation ──────────────────────────────────

  describe('createEvaluation', () => {
    const validDto = {
      group_id: GROUP_ID,
      title: 'Sprint 3',
      contributions: [
        { user_id: USER_ID, contribution_percent: 40 },
        { user_id: OTHER_USER_ID, contribution_percent: 35 },
        { user_id: THIRD_USER_ID, contribution_percent: 25 },
      ],
    };

    it('should create evaluation with valid equal split', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]); // leader
      membershipRepo.find.mockResolvedValue(mockMemberships);
      // findOne called after creation for formatting
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);

      const result = await service.createEvaluation(
        validDto,
        USER_ID,
        Role.STUDENT,
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('Sprint 3');
      expect(result.contributions).toHaveLength(3);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when group does not exist', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createEvaluation(validDto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when caller is not leader', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue({
        ...mockMemberships[1],
        role_in_group: 'MEMBER',
      });

      await expect(
        service.createEvaluation(validDto, OTHER_USER_ID, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow lecturer to create evaluation', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.find.mockResolvedValue(mockMemberships);
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);

      const result = await service.createEvaluation(
        validDto,
        USER_ID,
        Role.LECTURER,
      );

      expect(result).toBeDefined();
    });

    it('should throw BadRequestException when sum !== 100', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]);
      membershipRepo.find.mockResolvedValue(mockMemberships);

      const badDto = {
        ...validDto,
        contributions: [
          { user_id: USER_ID, contribution_percent: 50 },
          { user_id: OTHER_USER_ID, contribution_percent: 30 },
          { user_id: THIRD_USER_ID, contribution_percent: 10 }, // sum = 90
        ],
      };

      await expect(
        service.createEvaluation(badDto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept sum within ±0.01 tolerance', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]);
      membershipRepo.find.mockResolvedValue(mockMemberships);
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);

      const tolerantDto = {
        ...validDto,
        contributions: [
          { user_id: USER_ID, contribution_percent: 33.34 },
          { user_id: OTHER_USER_ID, contribution_percent: 33.33 },
          { user_id: THIRD_USER_ID, contribution_percent: 33.34 }, // sum = 100.01
        ],
      };

      const result = await service.createEvaluation(
        tolerantDto,
        USER_ID,
        Role.STUDENT,
      );
      expect(result).toBeDefined();
    });

    it('should throw BadRequestException when a member is missing', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]);
      membershipRepo.find.mockResolvedValue(mockMemberships);

      const incompleteDto = {
        ...validDto,
        contributions: [
          { user_id: USER_ID, contribution_percent: 60 },
          { user_id: OTHER_USER_ID, contribution_percent: 40 },
          // THIRD_USER_ID missing
        ],
      };

      await expect(
        service.createEvaluation(incompleteDto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when invalid member included', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]);
      membershipRepo.find.mockResolvedValue(mockMemberships);

      const invalidDto = {
        ...validDto,
        contributions: [
          { user_id: USER_ID, contribution_percent: 30 },
          { user_id: OTHER_USER_ID, contribution_percent: 30 },
          { user_id: THIRD_USER_ID, contribution_percent: 20 },
          {
            user_id: '99999999-9999-9999-9999-999999999999',
            contribution_percent: 20,
          },
        ],
      };

      await expect(
        service.createEvaluation(invalidDto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── update ────────────────────────────────────────────

  describe('update', () => {
    it('should update contributions (full replacement)', async () => {
      evaluationRepo.findOne
        .mockResolvedValueOnce({ ...mockEvaluation, created_by_id: USER_ID })
        .mockResolvedValueOnce(mockEvaluation);
      membershipRepo.find.mockResolvedValue(mockMemberships);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]); // for findOne membership check

      const result = await service.update(
        EVAL_ID,
        {
          contributions: [
            { user_id: USER_ID, contribution_percent: 50 },
            { user_id: OTHER_USER_ID, contribution_percent: 30 },
            { user_id: THIRD_USER_ID, contribution_percent: 20 },
          ],
        },
        USER_ID,
        Role.STUDENT,
      );

      expect(result).toBeDefined();
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when non-creator updates', async () => {
      evaluationRepo.findOne.mockResolvedValue({
        ...mockEvaluation,
        created_by_id: USER_ID,
      });

      await expect(
        service.update(EVAL_ID, { title: 'New' }, OTHER_USER_ID, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for non-existent evaluation', async () => {
      evaluationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update(EVAL_ID, { title: 'New' }, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── delete ────────────────────────────────────────────

  describe('delete', () => {
    it('should delete evaluation when caller is leader', async () => {
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);
      membershipRepo.findOne.mockResolvedValue(mockMemberships[0]); // leader

      const result = await service.delete(EVAL_ID, USER_ID, Role.STUDENT);
      expect(result.message).toBe('Evaluation deleted successfully');
      expect(evaluationRepo.remove).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent evaluation', async () => {
      evaluationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.delete(EVAL_ID, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getMyContribution ─────────────────────────────────

  describe('getMyContribution', () => {
    it('should return correct contribution for the caller', async () => {
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);
      contributionRepo.findOne.mockResolvedValue({
        evaluation_id: EVAL_ID,
        user_id: USER_ID,
        contribution_percent: 40,
        note: 'Good work',
      });

      const result = await service.getMyContribution(EVAL_ID, USER_ID);

      expect(result.contribution_percent).toBe(40);
      expect(result.note).toBe('Good work');
      expect(result.evaluation_id).toBe(EVAL_ID);
    });

    it('should throw NotFoundException when contribution not found', async () => {
      evaluationRepo.findOne.mockResolvedValue(mockEvaluation);
      contributionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMyContribution(
          EVAL_ID,
          '99999999-9999-9999-9999-999999999999',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated evaluations for group member', async () => {
      membershipRepo.findOne.mockResolvedValue(mockMemberships[1]);
      evaluationRepo.findAndCount.mockResolvedValue([[mockEvaluation], 1]);

      const result = await service.findAll(
        { group_id: GROUP_ID },
        OTHER_USER_ID,
        Role.STUDENT,
      );

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should throw ForbiddenException for non-member student', async () => {
      membershipRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAll(
          { group_id: GROUP_ID },
          '99999999-9999-9999-9999-999999999999',
          Role.STUDENT,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow lecturer to list any group evaluations', async () => {
      evaluationRepo.findAndCount.mockResolvedValue([[mockEvaluation], 1]);

      const result = await service.findAll(
        { group_id: GROUP_ID },
        USER_ID,
        Role.LECTURER,
      );

      expect(result.data).toHaveLength(1);
      expect(membershipRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
