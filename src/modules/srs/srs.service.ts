import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MembershipRole, SrsVersionStatus } from '../../common/enums';
import { ERROR_MESSAGES } from '../../common/constants';
import { Group } from '../../entities/group.entity';
import { GroupMembership } from '../../entities/group-membership.entity';
import { SrsDocument } from '../../entities/srs-document.entity';
import { SrsVersion } from '../../entities/srs-version.entity';
import { ReportService } from '../report/report.service';
import { UpdateSrsDraftDto } from './dto/update-srs-draft.dto';
import { ReviewSrsVersionDto } from './dto/review-srs-version.dto';

@Injectable()
export class SrsService {
  constructor(
    @InjectRepository(SrsDocument)
    private readonly srsDocRepo: Repository<SrsDocument>,
    @InjectRepository(SrsVersion)
    private readonly srsVersionRepo: Repository<SrsVersion>,
    @InjectRepository(GroupMembership)
    private readonly membershipRepo: Repository<GroupMembership>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly reportService: ReportService,
  ) {}

  private async requireGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMembership> {
    const membership = await this.membershipRepo.findOne({
      where: { group_id: groupId, user_id: userId, left_at: undefined },
    });
    if (!membership) {
      throw new ForbiddenException(ERROR_MESSAGES.SRS.NOT_GROUP_MEMBER);
    }
    return membership;
  }

  private async requireLeader(
    groupId: string,
    userId: string,
  ): Promise<GroupMembership> {
    const membership = await this.requireGroupMembership(groupId, userId);
    if (membership.role_in_group !== MembershipRole.LEADER) {
      throw new ForbiddenException(
        ERROR_MESSAGES.SRS.ONLY_LEADER_CAN_CREATE_VERSION,
      );
    }
    return membership;
  }

  async generateAndSaveDraft(
    groupId: string,
    userId: string,
  ): Promise<SrsDocument> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.NOT_FOUND);
    }

    const { markdown } = await this.reportService.generateSrs(groupId, userId);

    let doc = await this.srsDocRepo.findOne({ where: { group_id: groupId } });
    if (!doc) {
      doc = this.srsDocRepo.create({ group_id: groupId });
    }

    doc.draft_content = markdown;
    doc.draft_updated_at = new Date();
    doc.draft_updated_by_id = userId;

    return this.srsDocRepo.save(doc);
  }

  async getDocument(groupId: string): Promise<SrsDocument> {
    const doc = await this.srsDocRepo.findOne({
      where: { group_id: groupId },
      relations: ['versions', 'versions.submittedBy', 'versions.reviewedBy'],
      order: { versions: { version_number: 'DESC' } },
    });
    if (!doc) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.DOCUMENT_NOT_FOUND);
    }
    return doc;
  }

  async updateDraft(
    groupId: string,
    userId: string,
    dto: UpdateSrsDraftDto,
  ): Promise<SrsDocument> {
    await this.requireGroupMembership(groupId, userId);

    const doc = await this.srsDocRepo.findOne({
      where: { group_id: groupId },
    });
    if (!doc) {
      throw new ConflictException(ERROR_MESSAGES.SRS.DOCUMENT_NOT_FOUND);
    }

    doc.draft_content = dto.content;
    doc.draft_updated_at = new Date();
    doc.draft_updated_by_id = userId;

    return this.srsDocRepo.save(doc);
  }

  async createVersion(groupId: string, userId: string): Promise<SrsVersion> {
    await this.requireLeader(groupId, userId);

    const doc = await this.srsDocRepo.findOne({
      where: { group_id: groupId },
    });
    if (!doc) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.DOCUMENT_NOT_FOUND);
    }
    if (!doc.draft_content) {
      throw new BadRequestException(ERROR_MESSAGES.SRS.NO_DRAFT_CONTENT);
    }

    const lastVersion = await this.srsVersionRepo.findOne({
      where: { srs_document_id: doc.id },
      order: { version_number: 'DESC' },
    });
    const nextVersionNumber = lastVersion ? lastVersion.version_number + 1 : 1;

    const version = this.srsVersionRepo.create({
      srs_document_id: doc.id,
      version_number: nextVersionNumber,
      content: doc.draft_content,
      status: SrsVersionStatus.DRAFT,
      submitted_by_id: userId,
    });

    const saved = await this.srsVersionRepo.save(version);

    doc.draft_content = null;
    doc.draft_updated_at = new Date();
    doc.draft_updated_by_id = userId;
    await this.srsDocRepo.save(doc);

    return saved;
  }

  async submitVersion(
    groupId: string,
    versionId: string,
    userId: string,
  ): Promise<SrsVersion> {
    await this.requireLeader(groupId, userId);

    const doc = await this.srsDocRepo.findOne({
      where: { group_id: groupId },
    });
    if (!doc) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.DOCUMENT_NOT_FOUND);
    }

    const version = await this.srsVersionRepo.findOne({
      where: { id: versionId, srs_document_id: doc.id },
    });
    if (!version) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.VERSION_NOT_FOUND);
    }
    if (version.status !== SrsVersionStatus.DRAFT) {
      throw new BadRequestException(
        'Only draft versions can be submitted for review',
      );
    }

    const pendingSubmission = await this.srsVersionRepo.findOne({
      where: {
        srs_document_id: doc.id,
        status: SrsVersionStatus.SUBMITTED,
      },
    });
    if (pendingSubmission) {
      throw new ConflictException(
        ERROR_MESSAGES.SRS.ALREADY_HAS_PENDING_SUBMISSION,
      );
    }

    version.status = SrsVersionStatus.SUBMITTED;
    version.submitted_at = new Date();

    return this.srsVersionRepo.save(version);
  }

  async getVersion(groupId: string, versionId: string): Promise<SrsVersion> {
    const doc = await this.srsDocRepo.findOne({
      where: { group_id: groupId },
    });
    if (!doc) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.DOCUMENT_NOT_FOUND);
    }

    const version = await this.srsVersionRepo.findOne({
      where: { id: versionId, srs_document_id: doc.id },
      relations: ['submittedBy', 'reviewedBy'],
    });
    if (!version) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.VERSION_NOT_FOUND);
    }

    return version;
  }

  async reviewVersion(
    versionId: string,
    userId: string,
    dto: ReviewSrsVersionDto,
  ): Promise<SrsVersion> {
    if (
      dto.status !== SrsVersionStatus.APPROVED &&
      dto.status !== SrsVersionStatus.CHANGES_REQUESTED
    ) {
      throw new BadRequestException(ERROR_MESSAGES.SRS.INVALID_REVIEW_STATUS);
    }

    const version = await this.srsVersionRepo.findOne({
      where: { id: versionId },
      relations: ['srsDocument'],
    });
    if (!version) {
      throw new NotFoundException(ERROR_MESSAGES.SRS.VERSION_NOT_FOUND);
    }
    if (version.status !== SrsVersionStatus.SUBMITTED) {
      throw new BadRequestException(ERROR_MESSAGES.SRS.VERSION_NOT_SUBMITTED);
    }

    version.status = dto.status;
    version.reviewed_by_id = userId;
    version.reviewed_at = new Date();
    version.feedback = dto.feedback || null;

    const saved = await this.srsVersionRepo.save(version);

    if (dto.status === SrsVersionStatus.CHANGES_REQUESTED) {
      const doc = version.srsDocument;
      doc.draft_content = version.content;
      doc.draft_updated_at = new Date();
      doc.draft_updated_by_id = userId;
      await this.srsDocRepo.save(doc);
    }

    return saved;
  }

  async getLecturerSubmissions(classId?: string): Promise<SrsVersion[]> {
    const qb = this.srsVersionRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.srsDocument', 'doc')
      .innerJoin('doc.group', 'g')
      .addSelect(['g.id', 'g.name', 'g.class_id'])
      .innerJoin('g.class', 'c')
      .addSelect(['c.id', 'c.name'])
      .leftJoinAndSelect('v.submittedBy', 'submitter')
      .where('v.status = :status', { status: SrsVersionStatus.SUBMITTED })
      .orderBy('v.submitted_at', 'DESC');

    if (classId) {
      qb.andWhere('g.class_id = :classId', { classId });
    }

    return qb.getMany();
  }
}
