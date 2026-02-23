import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { QueryGroupsDto } from './dto/query-groups.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateGroupDto) {
    const group = await this.prisma.group.create({
      data: {
        name: dto.name,
        project_name: dto.project_name,
        description: dto.description,
        semester: dto.semester,
        github_repo_url: dto.github_repo_url,
        jira_project_key: dto.jira_project_key,
        created_by_id: userId,
      },
    });

    // Auto-add creator as LEADER
    await this.prisma.groupMembership.create({
      data: {
        group_id: group.id,
        user_id: userId,
        role_in_group: 'LEADER',
      },
    });

    return this.findOneById(group.id);
  }

  async findAll(userId: string, userRole: Role, query: QueryGroupsDto) {
    const { page = 1, limit = 20, semester, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.GroupWhereInput = {};

    // Role-based filtering: students only see groups they belong to
    if (userRole === Role.STUDENT || userRole === Role.GROUP_LEADER) {
      where.members = {
        some: { user_id: userId, left_at: null },
      };
    }
    // LECTURER and ADMIN see all groups

    if (semester) where.semester = semester;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { project_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [groups, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              members: { where: { left_at: null } },
            },
          },
        },
      }),
      this.prisma.group.count({ where }),
    ]);

    return {
      data: groups.map((group) => ({
        id: group.id,
        name: group.name,
        project_name: group.project_name,
        description: group.description,
        semester: group.semester,
        status: group.status,
        github_repo_url: group.github_repo_url,
        jira_project_key: group.jira_project_key,
        members_count: group._count.members,
        created_by_id: group.created_by_id,
        created_at: group.created_at,
        updated_at: group.updated_at,
      })),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(groupId: string, userId: string, userRole: Role) {
    const group = await this.findOneById(groupId);

    // Students/Leaders can only view groups they belong to
    if (userRole === Role.STUDENT || userRole === Role.GROUP_LEADER) {
      const isMember = group.members.some(
        (m) => m.user_id === userId && m.left_at === null,
      );
      if (!isMember) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }

    return this.formatGroupDetail(group);
  }

  async update(
    groupId: string,
    userId: string,
    userRole: Role,
    dto: UpdateGroupDto,
  ) {
    await this.assertGroupExists(groupId);
    await this.assertCanManageGroup(groupId, userId, userRole);

    await this.prisma.group.update({
      where: { id: groupId },
      data: dto,
    });

    const group = await this.findOneById(groupId);
    return this.formatGroupDetail(group);
  }

  async remove(groupId: string) {
    await this.assertGroupExists(groupId);

    // Delete memberships first, then group
    await this.prisma.groupMembership.deleteMany({
      where: { group_id: groupId },
    });
    await this.prisma.group.delete({ where: { id: groupId } });
  }

  // ── Member management ──────────────────────────────────

  async findMembers(groupId: string) {
    await this.assertGroupExists(groupId);

    const memberships = await this.prisma.groupMembership.findMany({
      where: { group_id: groupId, left_at: null },
      include: {
        user: {
          select: {
            id: true,
            full_name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { joined_at: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      full_name: m.user.full_name,
      email: m.user.email,
      avatar_url: m.user.avatar_url,
      role_in_group: m.role_in_group,
      joined_at: m.joined_at,
    }));
  }

  async addMember(
    groupId: string,
    dto: AddMemberDto,
    requesterId: string,
    requesterRole: Role,
  ) {
    await this.assertGroupExists(groupId);
    await this.assertCanManageGroup(groupId, requesterId, requesterRole);

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.user_id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if already a member (including soft-removed)
    const existing = await this.prisma.groupMembership.findUnique({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: dto.user_id,
        },
      },
    });

    if (existing && existing.left_at === null) {
      throw new BadRequestException('User is already a member of this group');
    }

    if (existing && existing.left_at !== null) {
      // Re-add: clear left_at and update role
      await this.prisma.groupMembership.update({
        where: {
          group_membership_unique: {
            group_id: groupId,
            user_id: dto.user_id,
          },
        },
        data: {
          left_at: null,
          role_in_group: dto.role_in_group || 'MEMBER',
          joined_at: new Date(),
        },
      });
    } else {
      await this.prisma.groupMembership.create({
        data: {
          group_id: groupId,
          user_id: dto.user_id,
          role_in_group: dto.role_in_group || 'MEMBER',
        },
      });
    }

    return this.findMembers(groupId);
  }

  async updateMember(
    groupId: string,
    memberId: string,
    dto: UpdateMemberDto,
    requesterId: string,
    requesterRole: Role,
  ) {
    await this.assertGroupExists(groupId);
    await this.assertCanManageGroup(groupId, requesterId, requesterRole);

    const membership = await this.prisma.groupMembership.findUnique({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: memberId,
        },
      },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException('Member not found in this group');
    }

    await this.prisma.groupMembership.update({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: memberId,
        },
      },
      data: { role_in_group: dto.role_in_group },
    });

    return this.findMembers(groupId);
  }

  async removeMember(
    groupId: string,
    memberId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    await this.assertGroupExists(groupId);
    await this.assertCanManageGroup(groupId, requesterId, requesterRole);

    const membership = await this.prisma.groupMembership.findUnique({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: memberId,
        },
      },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException('Member not found in this group');
    }

    // Prevent removing the last leader
    if (membership.role_in_group === 'LEADER') {
      const leaderCount = await this.prisma.groupMembership.count({
        where: {
          group_id: groupId,
          role_in_group: 'LEADER',
          left_at: null,
        },
      });
      if (leaderCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last leader. Assign another leader first.',
        );
      }
    }

    // Soft-remove by setting left_at
    await this.prisma.groupMembership.update({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: memberId,
        },
      },
      data: { left_at: new Date() },
    });
  }

  async leaveGroup(groupId: string, userId: string) {
    await this.assertGroupExists(groupId);

    const membership = await this.prisma.groupMembership.findUnique({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: userId,
        },
      },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException('You are not a member of this group');
    }

    // Prevent last leader from leaving
    if (membership.role_in_group === 'LEADER') {
      const leaderCount = await this.prisma.groupMembership.count({
        where: {
          group_id: groupId,
          role_in_group: 'LEADER',
          left_at: null,
        },
      });
      if (leaderCount <= 1) {
        throw new BadRequestException(
          'You are the last leader. Assign another leader before leaving.',
        );
      }
    }

    await this.prisma.groupMembership.update({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: userId,
        },
      },
      data: { left_at: new Date() },
    });
  }

  // ── Helpers ────────────────────────────────────────────

  private async findOneById(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { left_at: null },
          include: {
            user: {
              select: {
                id: true,
                full_name: true,
                email: true,
                avatar_url: true,
              },
            },
          },
          orderBy: { joined_at: 'asc' },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return group;
  }

  private formatGroupDetail(
    group: Awaited<ReturnType<GroupsService['findOneById']>>,
  ) {
    return {
      id: group.id,
      name: group.name,
      project_name: group.project_name,
      description: group.description,
      semester: group.semester,
      status: group.status,
      github_repo_url: group.github_repo_url,
      jira_project_key: group.jira_project_key,
      members_count: group.members.length,
      created_by_id: group.created_by_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      members: group.members.map((m) => ({
        id: m.user.id,
        full_name: m.user.full_name,
        email: m.user.email,
        avatar_url: m.user.avatar_url,
        role_in_group: m.role_in_group,
        joined_at: m.joined_at,
      })),
    };
  }

  private async assertGroupExists(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    return group;
  }

  private async assertCanManageGroup(
    groupId: string,
    userId: string,
    userRole: Role,
  ) {
    // Admins can always manage
    if (userRole === Role.ADMIN) return;

    const membership = await this.prisma.groupMembership.findUnique({
      where: {
        group_membership_unique: {
          group_id: groupId,
          user_id: userId,
        },
      },
    });

    if (
      !membership ||
      membership.left_at !== null ||
      membership.role_in_group !== 'LEADER'
    ) {
      throw new ForbiddenException(
        'Only group leaders can perform this action',
      );
    }
  }
}
