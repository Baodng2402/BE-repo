import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import {
  Class,
  ClassMembership,
  Group,
  GroupMembership,
  GroupRepository,
  GroupStatus,
  IntegrationProvider,
  IntegrationToken,
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
import { ReassignMembersDto } from './dto/reassign-members.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMembership)
    private readonly membershipRepository: Repository<GroupMembership>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepository: Repository<ClassMembership>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Topic)
    private readonly topicRepository: Repository<Topic>,
    @InjectRepository(GroupRepository)
    private readonly groupRepoRepository: Repository<GroupRepository>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @InjectRepository(Class)
    private readonly classRepository: Repository<Class>,
    private readonly dataSource: DataSource,
    private readonly githubService: GithubService,
    private readonly jiraService: JiraService,
  ) {}

  async create(userId: string, userRole: Role, dto: CreateGroupDto) {
    if (userRole !== Role.ADMIN && userRole !== Role.LECTURER) {
      throw new ForbiddenException(ERROR_MESSAGES.GROUPS.CREATE_FORBIDDEN);
    }

    const targetClass = await this.classRepository.findOne({
      where: { id: dto.class_id },
    });

    if (!targetClass) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }

    if (userRole === Role.LECTURER && targetClass.lecturer_id !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
    }

    const duplicateName = await this.groupRepository
      .createQueryBuilder('group')
      .where('group.class_id = :classId', { classId: dto.class_id })
      .andWhere('LOWER(group.name) = LOWER(:name)', { name: dto.name })
      .getExists();

    if (duplicateName) {
      throw new BadRequestException(
        ERROR_MESSAGES.GROUPS.NAME_ALREADY_EXISTS_IN_CLASS,
      );
    }

    const group = this.groupRepository.create({
      class_id: dto.class_id,
      name: dto.name,
      project_name: dto.project_name,
      description: dto.description,
      semester: dto.semester ?? targetClass.semester,
      github_repo_url: dto.github_repo_url,
      jira_project_key: dto.jira_project_key,
      created_by_id: userId,
    });

    const savedGroup = await this.groupRepository.save(group);

    return this.findOneById(savedGroup.id);
  }

  async findAll(userId: string, userRole: Role, query: QueryGroupsDto) {
    const { page = 1, limit = 20, semester, status, search } = query;
    const skip = (page - 1) * limit;

    const qb = this.groupRepository
      .createQueryBuilder('group')
      .distinct(true)
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
    const groupIds = groups.map((group) => group.id);

    let memberships: Array<
      Pick<GroupMembership, 'group_id' | 'role_in_group'>
    > = [];

    if (groupIds.length > 0) {
      const membershipRows = await this.membershipRepository.find({
        where: {
          group_id: In(groupIds),
          user_id: userId,
          left_at: IsNull(),
        },
        select: {
          group_id: true,
          role_in_group: true,
        },
      });

      memberships = Array.isArray(membershipRows) ? membershipRows : [];
    }

    const roleByGroupId = new Map(
      memberships.map((membership) => [
        membership.group_id,
        membership.role_in_group,
      ]),
    );

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
        my_role_in_group: roleByGroupId.get(group.id) || null,
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

    const existing = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: userId },
    });

    if (existing) {
      await this.membershipRepository.update(
        { group_id: groupId, user_id: userId },
        { left_at: null, role_in_group: userRole, joined_at: new Date() },
      );
    } else {
      const membership = this.membershipRepository.create({
        group_id: groupId,
        user_id: userId,
        role_in_group: userRole,
      });
      await this.membershipRepository.save(membership);
    }

    return { message: 'Joined group successfully', role_assigned: userRole };
  }

  async updateClassMemberCapacity(
    classId: string,
    maxStudentsPerGroup: number,
    requesterId: string,
    requesterRole: Role,
  ) {
    const targetClass = await this.classRepository.findOne({
      where: { id: classId },
    });

    if (!targetClass) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }

    if (
      requesterRole !== Role.ADMIN &&
      !(
        requesterRole === Role.LECTURER &&
        targetClass.lecturer_id === requesterId
      )
    ) {
      throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
    }

    const previous = targetClass.max_students_per_group;
    targetClass.max_students_per_group = maxStudentsPerGroup;
    await this.classRepository.save(targetClass);

    return {
      class_id: targetClass.id,
      previous_max_students_per_group: previous,
      max_students_per_group: targetClass.max_students_per_group,
    };
  }

  async getUngroupedStudentsByClass(
    classId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    const targetClass = await this.classRepository.findOne({
      where: { id: classId },
    });

    if (!targetClass) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }

    if (
      requesterRole !== Role.ADMIN &&
      !(
        requesterRole === Role.LECTURER &&
        targetClass.lecturer_id === requesterId
      )
    ) {
      throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
    }

    const activeGroupedRows = await this.membershipRepository
      .createQueryBuilder('membership')
      .innerJoin('membership.group', 'group')
      .select('membership.user_id', 'user_id')
      .where('group.class_id = :classId', { classId })
      .andWhere('membership.left_at IS NULL')
      .groupBy('membership.user_id')
      .getRawMany<{ user_id: string }>();

    const activeGroupedUserIds = new Set(
      activeGroupedRows.map((row) => row.user_id),
    );

    const classMemberships = await this.classMembershipRepository.find({
      where: { class_id: classId },
      relations: { user: true },
    });

    const ungroupedStudents = classMemberships
      .filter(
        (membership) =>
          membership.user &&
          [Role.STUDENT, Role.GROUP_LEADER].includes(membership.user.role) &&
          !activeGroupedUserIds.has(membership.user_id),
      )
      .map((membership) => ({
        id: membership.user.id,
        student_id: membership.user.student_id,
        full_name: membership.user.full_name,
        email: membership.user.email,
      }));

    return {
      class_id: classId,
      count: ungroupedStudents.length,
      students: ungroupedStudents,
    };
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

    if (
      dto.jira_project_key &&
      dto.jira_project_key !== group.jira_project_key
    ) {
      const jiraProject = await this.jiraService.validateProjectAccess(
        userId,
        dto.jira_project_key,
      );
      newJiraKey = jiraProject.key;
    }

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

  async remove(groupId: string, userId: string, userRole: Role) {
    const group = await this.assertGroupExists(groupId);

    if (userRole === Role.LECTURER) {
      const targetClass = await this.classRepository.findOne({
        where: { id: group.class_id },
      });
      if (!targetClass || targetClass.lecturer_id !== userId) {
        throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
      }
    } else if (userRole !== Role.ADMIN) {
      throw new ForbiddenException(
        ERROR_MESSAGES.GROUPS.ONLY_LEADERS_CAN_MANAGE,
      );
    }

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

    if (dto.role_in_group === MembershipRole.LEADER) {
      await this.dataSource.transaction(async (manager) => {
        await manager
          .createQueryBuilder()
          .update(GroupMembership)
          .set({ role_in_group: MembershipRole.MEMBER })
          .where('group_id = :groupId', { groupId })
          .andWhere('left_at IS NULL')
          .andWhere('user_id != :memberId', { memberId })
          .andWhere('role_in_group = :leaderRole', {
            leaderRole: MembershipRole.LEADER,
          })
          .execute();

        await manager
          .createQueryBuilder()
          .update(GroupMembership)
          .set({ role_in_group: MembershipRole.LEADER })
          .where('group_id = :groupId', { groupId })
          .andWhere('user_id = :memberId', { memberId })
          .execute();
      });
    } else {
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
        { role_in_group: dto.role_in_group },
      );
    }

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

  // ── Reassignment ───────────────────────────────────────

  async reassignMembers(
    sourceGroupId: string,
    dto: ReassignMembersDto,
    requesterId: string,
    requesterRole: Role,
  ) {
    const sourceGroup = await this.assertGroupExists(sourceGroupId);

    if (!sourceGroup.class_id) {
      throw new BadRequestException(
        ERROR_MESSAGES.GROUPS.SOURCE_GROUP_NOT_IN_CLASS,
      );
    }

    // Authorization: must be the class lecturer or ADMIN
    if (requesterRole !== Role.ADMIN) {
      const cls = await this.classRepository.findOne({
        where: { id: sourceGroup.class_id },
      });
      if (!cls || cls.lecturer_id !== requesterId) {
        throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
      }
    }

    // Fetch class for max_students_per_group
    const cls = await this.classRepository.findOne({
      where: { id: sourceGroup.class_id },
    });
    if (!cls) {
      throw new NotFoundException(ERROR_MESSAGES.CLASSES.NOT_FOUND);
    }

    // Fetch active members of source group
    const activeMembers = await this.membershipRepository.find({
      where: { group_id: sourceGroupId, left_at: IsNull() },
    });

    const activeMemberIds = new Set(activeMembers.map((m) => m.user_id));
    const dtoUserIds = dto.assignments.map((a) => a.user_id);

    // Check for duplicate user_ids
    if (new Set(dtoUserIds).size !== dtoUserIds.length) {
      throw new BadRequestException(
        ERROR_MESSAGES.GROUPS.DUPLICATE_MEMBER_IN_ASSIGNMENTS,
      );
    }

    // Validate all specified users are active members
    for (const userId of dtoUserIds) {
      if (!activeMemberIds.has(userId)) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.MEMBER_NOT_IN_SOURCE_GROUP,
        );
      }
    }

    const movingUserIds = new Set(dtoUserIds);
    const remainingMembers = activeMembers.filter(
      (m) => !movingUserIds.has(m.user_id),
    );

    // Leader protection: if remaining members exist, ensure at least one leader stays
    if (remainingMembers.length > 0) {
      const leadersBeingMoved = activeMembers.filter(
        (m) =>
          movingUserIds.has(m.user_id) &&
          m.role_in_group === MembershipRole.LEADER,
      );
      const totalLeaders = activeMembers.filter(
        (m) => m.role_in_group === MembershipRole.LEADER,
      ).length;

      if (leadersBeingMoved.length >= totalLeaders) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.CANNOT_MOVE_LAST_LEADER,
        );
      }
    }

    // Archive validation
    if (dto.archive_source && remainingMembers.length > 0) {
      throw new BadRequestException(
        ERROR_MESSAGES.GROUPS.CANNOT_ARCHIVE_NON_EMPTY_GROUP,
      );
    }

    // Validate target groups
    const targetGroupIds = [
      ...new Set(dto.assignments.map((a) => a.target_group_id)),
    ];

    const targetGroups = await this.groupRepository.find({
      where: { id: In(targetGroupIds) },
    });

    if (targetGroups.length !== targetGroupIds.length) {
      throw new NotFoundException(ERROR_MESSAGES.GROUPS.TARGET_GROUP_NOT_FOUND);
    }

    for (const tg of targetGroups) {
      if (tg.status !== GroupStatus.ACTIVE) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.TARGET_GROUP_NOT_ACTIVE,
        );
      }
      if (tg.class_id !== sourceGroup.class_id) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.TARGET_GROUP_NOT_IN_SAME_CLASS,
        );
      }
    }

    // Count current members per target group
    const countRows = await this.membershipRepository
      .createQueryBuilder('m')
      .select('m.group_id', 'group_id')
      .addSelect('COUNT(*)::int', 'count')
      .where('m.group_id IN (:...ids)', { ids: targetGroupIds })
      .andWhere('m.left_at IS NULL')
      .groupBy('m.group_id')
      .getRawMany<{ group_id: string; count: number }>();

    const currentCountMap = new Map(
      countRows.map((r) => [r.group_id, Number(r.count)]),
    );

    // Calculate incoming members per target group
    const incomingCountMap = new Map<string, number>();
    for (const a of dto.assignments) {
      incomingCountMap.set(
        a.target_group_id,
        (incomingCountMap.get(a.target_group_id) || 0) + 1,
      );
    }

    for (const [groupId, incoming] of incomingCountMap) {
      const current = currentCountMap.get(groupId) || 0;
      if (current + incoming > cls.max_students_per_group) {
        throw new BadRequestException({
          message: ERROR_MESSAGES.GROUPS.TARGET_GROUP_WOULD_EXCEED_MAX,
          code: 'TARGET_GROUP_WOULD_EXCEED_MAX',
          details: {
            target_group_id: groupId,
            current_capacity: cls.max_students_per_group,
            required_capacity: current + incoming,
            current_members: current,
            incoming_members: incoming,
          },
        });
      }
    }

    // Check no member is already active in their target group
    for (const a of dto.assignments) {
      const existing = await this.membershipRepository.findOne({
        where: {
          group_id: a.target_group_id,
          user_id: a.user_id,
          left_at: IsNull(),
        },
      });
      if (existing) {
        throw new BadRequestException(
          ERROR_MESSAGES.GROUPS.MEMBER_ALREADY_IN_TARGET_GROUP,
        );
      }
    }

    // Execute transaction
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();

      // Soft-delete moved members from source group
      for (const userId of movingUserIds) {
        await manager.update(
          GroupMembership,
          { group_id: sourceGroupId, user_id: userId },
          { left_at: now },
        );
      }

      // Create or reactivate memberships in target groups
      for (const a of dto.assignments) {
        const existingRow = await manager.findOne(GroupMembership, {
          where: { group_id: a.target_group_id, user_id: a.user_id },
        });

        if (existingRow) {
          await manager.update(
            GroupMembership,
            { group_id: a.target_group_id, user_id: a.user_id },
            {
              left_at: null,
              role_in_group: MembershipRole.MEMBER,
              joined_at: now,
            },
          );
        } else {
          const membership = manager.create(GroupMembership, {
            group_id: a.target_group_id,
            user_id: a.user_id,
            role_in_group: MembershipRole.MEMBER,
          });
          await manager.save(membership);
        }
      }

      // Archive source group if requested
      if (dto.archive_source) {
        await manager.update(
          Group,
          { id: sourceGroupId },
          { status: GroupStatus.ARCHIVED },
        );
      }
    });

    return {
      message: 'Members reassigned successfully',
      archived: dto.archive_source || false,
      reassigned_count: dto.assignments.length,
      remaining_count: remainingMembers.length,
    };
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

    if (userRole === Role.LECTURER) {
      const group = await this.assertGroupExists(groupId);
      const targetClass = await this.classRepository.findOne({
        where: { id: group.class_id },
      });

      if (!targetClass || targetClass.lecturer_id !== userId) {
        throw new ForbiddenException(ERROR_MESSAGES.GROUPS.NOT_CLASS_LECTURER);
      }
      return;
    }

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
    userRole: Role,
    data: { repo_url: string; repo_name: string; repo_owner: string },
  ) {
    // Verify the group exists
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    await this.assertCanManageGroup(groupId, userId, userRole);

    // Check if repo already linked
    const existing = await this.groupRepoRepository.findOne({
      where: { group_id: groupId, repo_url: data.repo_url },
    });
    if (existing) {
      throw new BadRequestException(
        'This repository is already linked to this group',
      );
    }

    const validatedRepo = await this.githubService.validateRepositoryAccess(
      userId,
      data.repo_owner,
      data.repo_name,
    );

    const repo = this.groupRepoRepository.create({
      group_id: groupId,
      repo_url: validatedRepo.html_url,
      repo_name: validatedRepo.name,
      repo_owner: validatedRepo.full_name.split('/')[0],
      added_by_id: userId,
    });

    return this.groupRepoRepository.save(repo);
  }

  async removeGroupRepo(
    groupId: string,
    repoId: string,
    userId: string,
    userRole: Role,
  ) {
    await this.assertCanManageGroup(groupId, userId, userRole);

    const repo = await this.groupRepoRepository.findOne({
      where: { id: repoId, group_id: groupId },
    });
    if (!repo) {
      throw new NotFoundException('Repository not found in this group');
    }

    await this.groupRepoRepository.delete({ id: repoId });
  }

  async getIntegrationStatus(groupId: string, userId: string, userRole: Role) {
    const group = await this.findOne(groupId, userId, userRole);
    const [githubToken, jiraToken, repos] = await Promise.all([
      this.integrationTokenRepository.findOne({
        where: { user_id: userId, provider: IntegrationProvider.GITHUB },
      }),
      this.integrationTokenRepository.findOne({
        where: { user_id: userId, provider: IntegrationProvider.JIRA },
      }),
      this.groupRepoRepository.find({
        where: { group_id: groupId },
        order: { created_at: 'ASC' },
      }),
    ]);

    const warnings: string[] = [];
    if (!githubToken) {
      warnings.push('GitHub account is not linked for the current user.');
    }
    if (!jiraToken) {
      warnings.push('Jira account is not linked for the current user.');
    }
    if (repos.length === 0) {
      warnings.push(
        'No GitHub repository is linked to this group. Commit analytics will be empty.',
      );
    }
    if (!group.jira_project_key) {
      warnings.push(
        'No Jira project is linked to this group. Assignment and SRS reports will be limited.',
      );
    }

    return {
      user: {
        github: {
          linked: !!githubToken,
          provider: IntegrationProvider.GITHUB,
          username: githubToken?.provider_username || null,
          email: githubToken?.provider_email || null,
        },
        jira: {
          linked: !!jiraToken,
          provider: IntegrationProvider.JIRA,
          username: jiraToken?.provider_username || null,
          email: jiraToken?.provider_email || null,
        },
      },
      group: {
        id: group.id,
        jiraProjectKey: group.jira_project_key,
        linkedReposCount: repos.length,
        repos: repos.map((repo) => ({
          id: repo.id,
          fullName: `${repo.repo_owner}/${repo.repo_name}`,
          url: repo.repo_url,
          isPrimary: repo.is_primary,
        })),
        reports: {
          canGenerateSrs: !!group.jira_project_key,
          canGenerateAssignments: !!group.jira_project_key,
          canGenerateCommits: repos.length > 0,
        },
      },
      warnings,
    };
  }

  async getIntegrationMappings(
    groupId: string,
    userId: string,
    userRole: Role,
  ) {
    const group = await this.findOne(groupId, userId, userRole);
    const repos = await this.groupRepoRepository.find({
      where: { group_id: groupId },
      order: { created_at: 'ASC' },
    });

    return {
      group_id: group.id,
      jira_project_key: group.jira_project_key,
      github_repositories: repos.map((repo) => ({
        id: repo.id,
        repo_url: repo.repo_url,
        repo_name: repo.repo_name,
        repo_owner: repo.repo_owner,
        is_primary: repo.is_primary,
      })),
    };
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
