import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MembershipRole, SrsVersionStatus } from '../../common/enums';
import { Group } from '../../entities/group.entity';
import { GroupMembership } from '../../entities/group-membership.entity';
import { SrsDocument } from '../../entities/srs-document.entity';
import { SrsVersion } from '../../entities/srs-version.entity';
import { ReportService } from '../report/report.service';
import { SrsService } from './srs.service';

// ── Test fixtures ────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const LECTURER_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VERSION_ID = 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv';

const leaderMembership = {
  group_id: GROUP_ID,
  user_id: USER_ID,
  role_in_group: MembershipRole.LEADER,
  left_at: null,
};

const memberMembership = {
  group_id: GROUP_ID,
  user_id: 'member-id',
  role_in_group: MembershipRole.MEMBER,
  left_at: null,
};

const mockDoc: Partial<SrsDocument> = {
  id: DOC_ID,
  group_id: GROUP_ID,
  draft_content: '# SRS Draft\n\nSome content here',
  draft_updated_at: new Date(),
  draft_updated_by_id: USER_ID,
};

const mockVersion: Partial<SrsVersion> = {
  id: VERSION_ID,
  srs_document_id: DOC_ID,
  version_number: 1,
  content: '# SRS v1',
  status: SrsVersionStatus.DRAFT,
  submitted_by_id: USER_ID,
  submitted_at: null,
  reviewed_by_id: null,
  reviewed_at: null,
  feedback: null,
};

// ── Mock factories ────────────────────────────────────────

const createMockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data) => ({ ...data })),
  save: jest.fn((entity) =>
    Promise.resolve({ ...entity, id: entity.id || DOC_ID }),
  ),
  createQueryBuilder: jest.fn(),
});

describe('SrsService', () => {
  let service: SrsService;
  let srsDocRepo: ReturnType<typeof createMockRepo>;
  let srsVersionRepo: ReturnType<typeof createMockRepo>;
  let membershipRepo: ReturnType<typeof createMockRepo>;
  let groupRepo: ReturnType<typeof createMockRepo>;
  let reportService: { generateSrs: jest.Mock };

  beforeEach(async () => {
    srsDocRepo = createMockRepo();
    srsVersionRepo = createMockRepo();
    membershipRepo = createMockRepo();
    groupRepo = createMockRepo();
    reportService = { generateSrs: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SrsService,
        { provide: getRepositoryToken(SrsDocument), useValue: srsDocRepo },
        { provide: getRepositoryToken(SrsVersion), useValue: srsVersionRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: membershipRepo,
        },
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        { provide: ReportService, useValue: reportService },
      ],
    }).compile();

    service = module.get<SrsService>(SrsService);
  });

  // ── generateAndSaveDraft ────────────────────────────────

  describe('generateAndSaveDraft', () => {
    it('should create new SrsDocument and save AI output as draft', async () => {
      groupRepo.findOne.mockResolvedValue({ id: GROUP_ID });
      reportService.generateSrs.mockResolvedValue({ markdown: '# AI SRS' });
      srsDocRepo.findOne.mockResolvedValue(null);

      const result = await service.generateAndSaveDraft(GROUP_ID, USER_ID);

      expect(reportService.generateSrs).toHaveBeenCalledWith(GROUP_ID, USER_ID);
      expect(srsDocRepo.create).toHaveBeenCalledWith({ group_id: GROUP_ID });
      expect(result.draft_content).toBe('# AI SRS');
      expect(result.draft_updated_by_id).toBe(USER_ID);
    });

    it('should update existing SrsDocument draft', async () => {
      groupRepo.findOne.mockResolvedValue({ id: GROUP_ID });
      reportService.generateSrs.mockResolvedValue({
        markdown: '# Updated SRS',
      });
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });

      const result = await service.generateAndSaveDraft(GROUP_ID, USER_ID);

      expect(srsDocRepo.create).not.toHaveBeenCalled();
      expect(result.draft_content).toBe('# Updated SRS');
    });

    it('should throw NotFoundException if group not found', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.generateAndSaveDraft(GROUP_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateDraft ─────────────────────────────────────────

  describe('updateDraft', () => {
    it('should update draft content for a group member', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });

      const result = await service.updateDraft(GROUP_ID, USER_ID, {
        content: '# Edited draft',
      });

      expect(result.draft_content).toBe('# Edited draft');
      expect(result.draft_updated_by_id).toBe(USER_ID);
    });

    it('should throw ForbiddenException if not a group member', async () => {
      membershipRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateDraft(GROUP_ID, USER_ID, { content: 'test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if no SrsDocument exists', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateDraft(GROUP_ID, USER_ID, { content: 'test' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── createVersion ───────────────────────────────────────

  describe('createVersion', () => {
    it('should snapshot draft into a new version and clear draft', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });
      srsVersionRepo.findOne.mockResolvedValue(null); // no existing versions

      const result = await service.createVersion(GROUP_ID, USER_ID);

      expect(result.version_number).toBe(1);
      expect(result.content).toBe(mockDoc.draft_content);
      expect(result.status).toBe(SrsVersionStatus.DRAFT);
      // Draft should be cleared
      expect(srsDocRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ draft_content: null }),
      );
    });

    it('should increment version_number', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });
      srsVersionRepo.findOne.mockResolvedValue({ version_number: 3 });

      const result = await service.createVersion(GROUP_ID, USER_ID);

      expect(result.version_number).toBe(4);
    });

    it('should throw ForbiddenException if not a leader', async () => {
      membershipRepo.findOne.mockResolvedValue(memberMembership);

      await expect(
        service.createVersion(GROUP_ID, 'member-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if no draft content', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc, draft_content: null });

      await expect(service.createVersion(GROUP_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── submitVersion ───────────────────────────────────────

  describe('submitVersion', () => {
    it('should set status to SUBMITTED', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });
      srsVersionRepo.findOne
        .mockResolvedValueOnce({ ...mockVersion }) // the version to submit
        .mockResolvedValueOnce(null); // no pending submissions

      const result = await service.submitVersion(GROUP_ID, VERSION_ID, USER_ID);

      expect(result.status).toBe(SrsVersionStatus.SUBMITTED);
      expect(result.submitted_at).toBeTruthy();
    });

    it('should throw ConflictException if another version is already submitted', async () => {
      membershipRepo.findOne.mockResolvedValue(leaderMembership);
      srsDocRepo.findOne.mockResolvedValue({ ...mockDoc });
      srsVersionRepo.findOne
        .mockResolvedValueOnce({ ...mockVersion })
        .mockResolvedValueOnce({
          id: 'other-version',
          status: SrsVersionStatus.SUBMITTED,
        });

      await expect(
        service.submitVersion(GROUP_ID, VERSION_ID, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ForbiddenException if not a leader', async () => {
      membershipRepo.findOne.mockResolvedValue(memberMembership);

      await expect(
        service.submitVersion(GROUP_ID, VERSION_ID, 'member-id'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── reviewVersion ───────────────────────────────────────

  describe('reviewVersion', () => {
    const submittedVersion = {
      ...mockVersion,
      status: SrsVersionStatus.SUBMITTED,
      srsDocument: { ...mockDoc },
    };

    it('should approve a submitted version', async () => {
      srsVersionRepo.findOne.mockResolvedValue({ ...submittedVersion });

      const result = await service.reviewVersion(VERSION_ID, LECTURER_ID, {
        status: SrsVersionStatus.APPROVED,
        feedback: 'Looks good!',
      });

      expect(result.status).toBe(SrsVersionStatus.APPROVED);
      expect(result.reviewed_by_id).toBe(LECTURER_ID);
      expect(result.feedback).toBe('Looks good!');
    });

    it('should restore draft on CHANGES_REQUESTED', async () => {
      srsVersionRepo.findOne.mockResolvedValue({ ...submittedVersion });

      await service.reviewVersion(VERSION_ID, LECTURER_ID, {
        status: SrsVersionStatus.CHANGES_REQUESTED,
        feedback: 'Please revise section 3',
      });

      expect(srsDocRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          draft_content: submittedVersion.content,
        }),
      );
    });

    it('should throw BadRequestException if version is not SUBMITTED', async () => {
      srsVersionRepo.findOne.mockResolvedValue({
        ...mockVersion,
        status: SrsVersionStatus.DRAFT,
        srsDocument: { ...mockDoc },
      });

      await expect(
        service.reviewVersion(VERSION_ID, LECTURER_ID, {
          status: SrsVersionStatus.APPROVED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if version not found', async () => {
      srsVersionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reviewVersion(VERSION_ID, LECTURER_ID, {
          status: SrsVersionStatus.APPROVED,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getDocument ─────────────────────────────────────────

  describe('getDocument', () => {
    it('should return document with versions', async () => {
      srsDocRepo.findOne.mockResolvedValue({
        ...mockDoc,
        versions: [mockVersion],
      });

      const result = await service.getDocument(GROUP_ID);

      expect(result.id).toBe(DOC_ID);
      expect(result.versions).toHaveLength(1);
    });

    it('should throw NotFoundException if no document exists', async () => {
      srsDocRepo.findOne.mockResolvedValue(null);

      await expect(service.getDocument(GROUP_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
