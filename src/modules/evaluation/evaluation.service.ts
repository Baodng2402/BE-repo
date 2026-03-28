import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  Evaluation,
  EvaluationContribution,
  Group,
  GroupMembership,
  MembershipRole,
  Role,
} from '../../entities';
import { ERROR_MESSAGES } from '../../common/constants';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { UpdateEvaluationDto } from './dto/update-evaluation.dto';
import { QueryEvaluationsDto } from './dto/query-evaluations.dto';
import { ContributionItemDto } from './dto/contribution-item.dto';

@Injectable()
export class EvaluationService {
  constructor(
    @InjectRepository(Evaluation)
    private readonly evaluationRepo: Repository<Evaluation>,
    @InjectRepository(EvaluationContribution)
    private readonly contributionRepo: Repository<EvaluationContribution>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupMembership)
    private readonly membershipRepo: Repository<GroupMembership>,
    private readonly dataSource: DataSource,
  ) {}

  async createEvaluation(
    dto: CreateEvaluationDto,
    userId: string,
    userRole: Role,
  ) {
    const group = await this.groupRepo.findOne({
      where: { id: dto.group_id },
    });
    if (!group) {
      throw new NotFoundException(ERROR_MESSAGES.EVALUATIONS.GROUP_NOT_FOUND);
    }

    await this.assertCanManageEvaluation(dto.group_id, userId, userRole);

    const activeMembers = await this.getActiveMembers(dto.group_id);
    this.validateContributions(dto.contributions, activeMembers);

    return this.dataSource.transaction(async (manager) => {
      const evaluation = manager.create(Evaluation, {
        group_id: dto.group_id,
        title: dto.title,
        description: dto.description || null,
        created_by_id: userId,
      });
      const savedEvaluation = await manager.save(evaluation);

      const contributions = dto.contributions.map((item) =>
        manager.create(EvaluationContribution, {
          evaluation_id: savedEvaluation.id,
          user_id: item.user_id,
          contribution_percent: item.contribution_percent,
          note: item.note || null,
        }),
      );
      await manager.save(contributions);

      return this.findOne(savedEvaluation.id, userId, userRole);
    });
  }

  async findAll(dto: QueryEvaluationsDto, userId: string, userRole: Role) {
    if (userRole !== Role.LECTURER && userRole !== Role.ADMIN) {
      const membership = await this.membershipRepo.findOne({
        where: {
          group_id: dto.group_id,
          user_id: userId,
          left_at: IsNull(),
        },
      });
      if (!membership) {
        throw new ForbiddenException(
          ERROR_MESSAGES.EVALUATIONS.NOT_GROUP_MEMBER,
        );
      }
    }

    const [evaluations, total] = await this.evaluationRepo.findAndCount({
      where: { group_id: dto.group_id },
      relations: ['createdBy'],
      order: { created_at: 'DESC' },
      skip: ((dto.page || 1) - 1) * (dto.limit || 20),
      take: dto.limit || 20,
    });

    return {
      data: evaluations.map((e) => ({
        id: e.id,
        group_id: e.group_id,
        title: e.title,
        description: e.description,
        created_by: {
          id: e.createdBy.id,
          full_name: e.createdBy.full_name,
          avatar_url: e.createdBy.avatar_url,
        },
        created_at: e.created_at,
        updated_at: e.updated_at,
      })),
      total,
      page: dto.page || 1,
      limit: dto.limit || 20,
    };
  }

  async findOne(evaluationId: string, userId: string, userRole: Role) {
    const evaluation = await this.evaluationRepo.findOne({
      where: { id: evaluationId },
      relations: ['createdBy', 'contributions', 'contributions.user'],
    });

    if (!evaluation) {
      throw new NotFoundException(ERROR_MESSAGES.EVALUATIONS.NOT_FOUND);
    }

    if (userRole !== Role.LECTURER && userRole !== Role.ADMIN) {
      const membership = await this.membershipRepo.findOne({
        where: {
          group_id: evaluation.group_id,
          user_id: userId,
          left_at: IsNull(),
        },
      });
      if (!membership) {
        throw new ForbiddenException(
          ERROR_MESSAGES.EVALUATIONS.NOT_GROUP_MEMBER,
        );
      }
    }

    return this.formatEvaluationDetail(evaluation);
  }

  async update(
    evaluationId: string,
    dto: UpdateEvaluationDto,
    userId: string,
    userRole: Role,
  ) {
    const evaluation = await this.evaluationRepo.findOne({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new NotFoundException(ERROR_MESSAGES.EVALUATIONS.NOT_FOUND);
    }

    if (evaluation.created_by_id !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException(ERROR_MESSAGES.EVALUATIONS.FORBIDDEN);
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.title !== undefined) {
        evaluation.title = dto.title;
      }
      if (dto.description !== undefined) {
        evaluation.description = dto.description;
      }

      if (dto.contributions) {
        const activeMembers = await this.getActiveMembers(evaluation.group_id);
        this.validateContributions(dto.contributions, activeMembers);

        await manager.delete(EvaluationContribution, {
          evaluation_id: evaluationId,
        });

        const contributions = dto.contributions.map((item) =>
          manager.create(EvaluationContribution, {
            evaluation_id: evaluationId,
            user_id: item.user_id,
            contribution_percent: item.contribution_percent,
            note: item.note || null,
          }),
        );
        await manager.save(contributions);
      }

      await manager.save(evaluation);
      return this.findOne(evaluationId, userId, userRole);
    });
  }

  async delete(evaluationId: string, userId: string, userRole: Role) {
    const evaluation = await this.evaluationRepo.findOne({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new NotFoundException(ERROR_MESSAGES.EVALUATIONS.NOT_FOUND);
    }

    await this.assertCanManageEvaluation(evaluation.group_id, userId, userRole);

    await this.evaluationRepo.remove(evaluation);
    return { message: 'Evaluation deleted successfully' };
  }

  async getMyContribution(evaluationId: string, userId: string) {
    const evaluation = await this.evaluationRepo.findOne({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new NotFoundException(ERROR_MESSAGES.EVALUATIONS.NOT_FOUND);
    }

    const contribution = await this.contributionRepo.findOne({
      where: { evaluation_id: evaluationId, user_id: userId },
    });

    if (!contribution) {
      throw new NotFoundException(
        ERROR_MESSAGES.EVALUATIONS.CONTRIBUTION_NOT_FOUND,
      );
    }

    return {
      evaluation_id: evaluation.id,
      title: evaluation.title,
      contribution_percent: Number(contribution.contribution_percent),
      note: contribution.note,
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private async getActiveMembers(groupId: string): Promise<string[]> {
    const memberships = await this.membershipRepo.find({
      where: { group_id: groupId, left_at: IsNull() },
    });
    return memberships.map((m) => m.user_id);
  }

  private validateContributions(
    contributions: ContributionItemDto[],
    activeMemberIds: string[],
  ) {
    const providedIds = contributions.map((c) => c.user_id);
    const uniqueProvidedIds = [...new Set(providedIds)];

    // Check all active members are included
    const missingMembers = activeMemberIds.filter(
      (id) => !uniqueProvidedIds.includes(id),
    );
    if (missingMembers.length > 0) {
      throw new BadRequestException(ERROR_MESSAGES.EVALUATIONS.MISSING_MEMBERS);
    }

    // Check no invalid members included
    const invalidMembers = uniqueProvidedIds.filter(
      (id) => !activeMemberIds.includes(id),
    );
    if (invalidMembers.length > 0) {
      throw new BadRequestException(ERROR_MESSAGES.EVALUATIONS.INVALID_MEMBER);
    }

    // Check sum = 100% (±0.05 tolerance for floating-point rounding)
    const sum = contributions.reduce(
      (acc, c) => acc + c.contribution_percent,
      0,
    );
    const roundedSum = Math.round(sum * 100) / 100;
    if (Math.abs(roundedSum - 100) > 0.05) {
      throw new BadRequestException(ERROR_MESSAGES.EVALUATIONS.SUM_NOT_100);
    }
  }

  private async assertCanManageEvaluation(
    groupId: string,
    userId: string,
    userRole: Role,
  ) {
    if (userRole === Role.ADMIN || userRole === Role.LECTURER) {
      return;
    }

    const membership = await this.membershipRepo.findOne({
      where: { group_id: groupId, user_id: userId, left_at: IsNull() },
    });

    if (!membership) {
      throw new ForbiddenException(ERROR_MESSAGES.EVALUATIONS.NOT_GROUP_MEMBER);
    }

    if (membership.role_in_group !== MembershipRole.LEADER) {
      throw new ForbiddenException(ERROR_MESSAGES.EVALUATIONS.FORBIDDEN);
    }
  }

  private formatEvaluationDetail(evaluation: Evaluation) {
    return {
      id: evaluation.id,
      group_id: evaluation.group_id,
      title: evaluation.title,
      description: evaluation.description,
      created_by: {
        id: evaluation.createdBy.id,
        full_name: evaluation.createdBy.full_name,
        avatar_url: evaluation.createdBy.avatar_url,
      },
      created_at: evaluation.created_at,
      updated_at: evaluation.updated_at,
      contributions: (evaluation.contributions || []).map((c) => ({
        user_id: c.user_id,
        full_name: c.user?.full_name || null,
        avatar_url: c.user?.avatar_url || null,
        contribution_percent: Number(c.contribution_percent),
        note: c.note,
      })),
    };
  }
}
