import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import {
  Group,
  GroupMembership,
  GroupRepository,
  MembershipRole,
  Role,
  Topic,
  User,
} from '../../entities';
import { GithubService } from '../github/github.service';
import { JiraService } from '../jira/jira.service';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { QueryGroupsDto } from './dto/query-groups.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMembership)
    private readonly membershipRepository: Repository<GroupMembership>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Topic)
    private readonly topicRepository: Repository<Topic>,
    @InjectRepository(GroupRepository)
    private readonly groupRepoRepository: Repository<GroupRepository>,
    private readonly githubService: GithubService,
    private readonly jiraService: JiraService,
  ) {}

  async create(userId: string, dto: CreateGroupDto) {
    const group = this.groupRepository.create({
      name: dto.name,
      project_name: dto.project_name,
      description: dto.description,
      semester: dto.semester,
      github_repo_url: dto.github_repo_url,
      jira_project_key: dto.jira_project_key,
      created_by_id: userId,
    });

    const savedGroup = await this.groupRepository.save(group);

    const membership = this.membershipRepository.create({
      group_id: savedGroup.id,
      user_id: userId,
      role_in_group: MembershipRole.LEADER,
    });
    await this.membershipRepository.save(membership);

    return this.findOneById(savedGroup.id);
  }

  async findAll(userId: string, userRole: Role, query: QueryGroupsDto) {
    const { page = 1, limit = 20, semester, status, search } = query;
    const skip = (page - 1) * limit;

    const qb = this.groupRepository
      .createQueryBuilder('group')
      .loadRelationCountAndMap(
        'group.members_count',
        'group.members',
        'memberCount',
        (sqb) => sqb.where('memberCount.left_at IS NULL'),
      );

    // Role-based filtering: students only see groups they belong to
    if (userRole === Role.STUDENT || userRole === Role.GROUP_LEADER) {
      qb.innerJoin(
        'group.members',
        'activeMember',
        'activeMember.user_id = :userId AND activeMember.left_at IS NULL',
        { userId },
      );
    }

    if (semester) {
      qb.andWhere('group.semester = :semester', { semester });
    }
    if (status) {
      qb.andWhere('group.status = :status', { status });
    }
    if (search) {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb
            .where('LOWER(group.name) LIKE LOWER(:search)', {
              search: `%${search}%`,
            })
            .orWhere('LOWER(group.project_name) LIKE LOWER(:search)', {
              search: `%${search}%`,
            });
        }),
      );
    }

    qb.orderBy('group.created_at', 'DESC').skip(skip).take(limit);

    const [groups, total] = await qb.getManyAndCount();

    return {
      data: groups.map((group: any) => ({
        id: group.id,
        name: group.name,
        project_name: group.project_name,
        description: group.description,
        semester: group.semester,
        status: group.status,
        github_repo_url: group.github_repo_url,
        jira_project_key: group.jira_project_key,
        members_count: group.members_count ?? 0,
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

    // Lecturers should be able to view groups, not just members.
    if (userRole === Role.STUDENT || userRole === Role.GROUP_LEADER) {
      const isMember = group.members?.some(
        (m) => m.user_id === userId && m.left_at === null,
      );
      if (!isMember) {
        throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_A_MEMBER);
      }
    }

    return this.formatGroupDetail(group);
  }

  async getGroupsByClass(classId: string, userId: string, userRole: Role) {
    // Basic implementation: fetch all groups for this class_id
    // Lecturers get all, Students get all to see availability
    const qb = this.groupRepository
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.topic', 'topic')
      .leftJoinAndSelect('group.members', 'member', 'member.left_at IS NULL')
      .leftJoinAndSelect('member.user', 'user')
      .loadRelationCountAndMap(
        'group.members_count',
        'group.members',
        'memberCount',
        (sqb) => sqb.where('memberCount.left_at IS NULL'),
      )
      .where('group.class_id = :classId', { classId })
      .orderBy('group.name', 'ASC');

    const groups = await qb.getMany();

    return groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      project_name: g.project_name,
      topic: g.topic,
      members_count: g.members_count ?? 0,
      status: g.status,
      members:
        g.members?.map((m: any) => ({
          user_id: m.user_id,
          full_name: m.user?.full_name,
          role: m.role_in_group,
        })) || [],
    }));
  }

  async joinEmptyGroup(groupId: string, userId: string) {
    await this.assertGroupExists(groupId);

    // Ensure user is not already in a group for this class
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group || !group.class_id)
      throw new NotFoundException('Group or class not found');

    const myOtherGroupsInClass = await this.membershipRepository
      .createQueryBuilder('m')
      .innerJoin('m.group', 'g')
      .where('m.user_id = :userId', { userId })
      .andWhere('g.class_id = :classId', { classId: group.class_id })
      .andWhere('m.left_at IS NULL')
      .getCount();

    if (myOtherGroupsInClass > 0) {
      throw new BadRequestException(
        'You are already in a group for this class',
      );
    }

    const membersCount = await this.membershipRepository.count({
      where: { group_id: groupId, left_at: IsNull() },
    });

    if (membersCount >= 5) {
      // Assuming 5 max per group
      throw new BadRequestException('Group is already full');
    }

    const userRole =
      membersCount === 0 ? MembershipRole.LEADER : MembershipRole.MEMBER;

    const membership = this.membershipRepository.create({
      group_id: groupId,
      user_id: userId,
      role_in_group: userRole,
    });

    await this.membershipRepository.save(membership);
    return { message: 'Joined group successfully', role_assigned: userRole };
  }

  async update(
    groupId: string,
    userId: string,
    userRole: Role,
    dto: UpdateGroupDto,
  ) {
    const group = await this.assertGroupExists(groupId);
    await this.assertCanManageGroup(groupId, userId, userRole);

    let newGithubUrl = dto.github_repo_url;
    let newJiraKey = dto.jira_project_key;

    // Detect if a new topic is assigned, to trigger auto-provisioning
    if (dto.topic_id && dto.topic_id !== group.topic_id) {
      const topic = await this.topicRepository.findOne({
        where: { id: dto.topic_id },
      });
      if (!topic) throw new NotFoundException('Topic not found');

      const topicAlreadyUsed = await this.groupRepository.exist({
        where: { topic_id: dto.topic_id },
      });

      if (topicAlreadyUsed) {
        throw new BadRequestException(
          'This topic has already been selected by another group.',
        );
      }

      try {
        // Auto-provision Github Repo (Private)
        const repoName =
          `${topic.name.replace(/[^a-zA-Z0-9]/g, '-')}-${group.name.replace(/[^a-zA-Z0-9]/g, '-')}`.toLowerCase();
        const githubData = await this.githubService.createRepository(
          group.created_by_id,
          repoName,
          topic.description || '',
        );
        if (githubData && githubData.html_url) {
          newGithubUrl = githubData.html_url;
          // Also link it in project_links implicitly for AI tools
          await this.jiraService.linkProject(
            group.created_by_id,
            githubData.full_name,
            '',
          ); // Just creating the skeleton
        }

        // Auto-provision Jira Project
        const projectKey = repoName.substring(0, 8); // Keep it short
        const jiraData = await this.jiraService.createProject(
          group.created_by_id,
          repoName,
          projectKey,
        );

        if (jiraData && jiraData.id) {
          // We expect the key to be returned, or we use the sent key
          newJiraKey = jiraData.projectKey || projectKey;

          if (githubData && githubData.full_name) {
            await this.jiraService.linkProject(
              group.created_by_id,
              githubData.full_name,
              jiraData.id.toString(),
            );
          }
        }
      } catch (e: any) {
        console.warn('Auto-provisioning warning:', e.message);
        // Continue even if provisioning partially fails, perhaps they haven't linked their accounts yet.
        // Or we could throw an exception to force them to link, but let's be forgiving in MVP.
      }
    }

    await this.groupRepository.update(
      { id: groupId },
      {
        name: dto.name,
        project_name: dto.project_name,
        description: dto.description,
        semester: dto.semester,
        github_repo_url: newGithubUrl,
        jira_project_key: newJiraKey,
        status: dto.status,
        topic_id: dto.topic_id,
      },
    );

    if (dto.topic_id && dto.topic_id !== group.topic_id) {
      await this.topicRepository.update(
        { id: dto.topic_id },
        { is_taken: true },
      );

      if (group.topic_id) {
        const stillReferenced = await this.groupRepository.exist({
          where: { topic_id: group.topic_id },
        });

        if (!stillReferenced) {
          await this.topicRepository.update(
            { id: group.topic_id },
            { is_taken: false },
          );
        }
      }
    }

    const updatedGroup = await this.findOneById(groupId);
    return this.formatGroupDetail(updatedGroup);
  }

  async remove(groupId: string) {
    await this.assertGroupExists(groupId);

    await this.membershipRepository.delete({ group_id: groupId });
    await this.groupRepository.delete({ id: groupId });
  }

  // ── Member management ──────────────────────────────────

  async findMembers(groupId: string) {
    await this.assertGroupExists(groupId);

    const memberships = await this.membershipRepository.find({
      where: { group_id: groupId, left_at: IsNull() },
      relations: ['user'],
      order: { joined_at: 'ASC' },
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

    const user = await this.userRepository.findOne({
      where: { id: dto.user_id },
    });
    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.USER_NOT_FOUND);
    }

    const existing = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: dto.user_id },
    });

    if (existing && existing.left_at === null) {
      throw new BadRequestException(ERROR_MESSAGES.GROUPS.ALREADY_A_MEMBER);
    }

    if (existing && existing.left_at !== null) {
      await this.membershipRepository.update(
        { group_id: groupId, user_id: dto.user_id },
        {
          left_at: null,
          role_in_group: dto.role_in_group || MembershipRole.MEMBER,
          joined_at: new Date(),
        },
      );
    } else {
      const membership = this.membershipRepository.create({
        group_id: groupId,
        user_id: dto.user_id,
        role_in_group: dto.role_in_group || MembershipRole.MEMBER,
      });
      await this.membershipRepository.save(membership);
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

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: memberId },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.MEMBER_NOT_FOUND);
    }

    await this.membershipRepository.update(
      { group_id: groupId, user_id: memberId },
      { role_in_group: dto.role_in_group },
    );

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

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: memberId },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.MEMBER_NOT_FOUND);
    }

    if (membership.role_in_group === MembershipRole.LEADER) {
      const leaderCount = await this.membershipRepository.count({
        where: {
          group_id: groupId,
          role_in_group: MembershipRole.LEADER,
          left_at: IsNull(),
        },
      });
      if (leaderCount <= 1) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.CANNOT_REMOVE_LAST_LEADER,
        );
      }
    }

    await this.membershipRepository.update(
      { group_id: groupId, user_id: memberId },
      { left_at: new Date() },
    );
  }

  async leaveGroup(groupId: string, userId: string) {
    await this.assertGroupExists(groupId);

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: userId },
    });

    if (!membership || membership.left_at !== null) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.NOT_A_MEMBER);
    }

    if (membership.role_in_group === MembershipRole.LEADER) {
      const leaderCount = await this.membershipRepository.count({
        where: {
          group_id: groupId,
          role_in_group: MembershipRole.LEADER,
          left_at: IsNull(),
        },
      });
      if (leaderCount <= 1) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.CANNOT_LEAVE_AS_LAST_LEADER,
        );
      }
    }

    await this.membershipRepository.update(
      { group_id: groupId, user_id: userId },
      { left_at: new Date() },
    );
  }

  // ── Helpers ────────────────────────────────────────────

  private async findOneById(groupId: string) {
    const group = await this.groupRepository
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.members', 'member', 'member.left_at IS NULL')
      .leftJoinAndSelect('member.user', 'user')
      .leftJoinAndSelect('group.topic', 'topic')
      .where('group.id = :id', { id: groupId })
      .orderBy('member.joined_at', 'ASC')
      .getOne();

    if (!group) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.NOT_FOUND);
    }

    return group;
  }

  private formatGroupDetail(group: Group) {
    const members = group.members || [];
    return {
      id: group.id,
      name: group.name,
      project_name: group.project_name,
      description: group.description,
      semester: group.semester,
      status: group.status,
      github_repo_url: group.github_repo_url,
      jira_project_key: group.jira_project_key,
      topic: group.topic,
      members_count: members.length,
      created_by_id: group.created_by_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      members: members.map((m) => ({
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
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.NOT_FOUND);
    }
    return group;
  }

  private async assertCanManageGroup(
    groupId: string,
    userId: string,
    userRole: Role,
  ) {
    if (userRole === Role.ADMIN) return;

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: userId },
    });

    if (
      !membership ||
      membership.left_at !== null ||
      membership.role_in_group !== MembershipRole.LEADER
    ) {
      throw new ForbiddenException(
        ERROR_MESSAGES.GROUPS.ONLY_LEADERS_CAN_MANAGE,
      );
    }
  }

  // ── Repository management ──────────────────────────────

  async getGroupRepos(groupId: string) {
    return this.groupRepoRepository.find({
      where: { group_id: groupId },
      order: { created_at: 'ASC' },
    });
  }

  async addGroupRepo(
    groupId: string,
    userId: string,
    data: { repo_url: string; repo_name: string; repo_owner: string },
  ) {
    // Verify the group exists
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Check if repo already linked
    const existing = await this.groupRepoRepository.findOne({
      where: { group_id: groupId, repo_url: data.repo_url },
    });
    if (existing) {
      throw new BadRequestException(
        'This repository is already linked to this group',
      );
    }

    const repo = this.groupRepoRepository.create({
      group_id: groupId,
      repo_url: data.repo_url,
      repo_name: data.repo_name,
      repo_owner: data.repo_owner,
      added_by_id: userId,
    });

    return this.groupRepoRepository.save(repo);
  }

  async removeGroupRepo(groupId: string, repoId: string, userId: string) {
    const repo = await this.groupRepoRepository.findOne({
      where: { id: repoId, group_id: groupId },
    });
    if (!repo) {
      throw new NotFoundException('Repository not found in this group');
    }

    await this.groupRepoRepository.delete({ id: repoId });
  }

  async getGroupRepoCommits(groupId: string, repoId: string) {
    const repo = await this.groupRepoRepository.findOne({
      where: { id: repoId, group_id: groupId },
    });

    if (!repo) {
      throw new NotFoundException('Group repository not found');
    }

    if (!repo.repo_owner || !repo.repo_name) {
      throw new BadRequestException('Repository owner or name is missing');
    }

    // We use the token of the user who added the repository to view it
    return this.githubService.getRepoCommits(
      repo.added_by_id,
      repo.repo_owner,
      repo.repo_name,
    );
  }
}
