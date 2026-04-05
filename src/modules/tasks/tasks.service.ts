import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import {
  IntegrationProvider,
  MembershipRole,
  Role,
  TaskJiraSyncStatus,
  TaskPriority,
  TaskStatus,
} from '../../common/enums';
import { createIntegrationException } from '../../common/errors/integration-error';
import {
  Group,
  GroupMembership,
  IntegrationToken,
  Task,
  User,
} from '../../entities';
import { JiraService } from '../jira/jira.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMembership)
    private readonly membershipRepository: Repository<GroupMembership>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    private readonly jiraService: JiraService,
  ) {}

  private getIntegrationErrorBody(error: unknown) {
    if (!(error instanceof HttpException)) {
      return null;
    }

    const response = error.getResponse();
    if (!response || typeof response !== 'object') {
      return null;
    }

    return response as {
      code?: string;
      message?: string;
      reconnectRequired?: boolean;
      details?: Record<string, unknown>;
    };
  }

  async findAll(userId: string, query: QueryTasksDto) {
    const {
      group_id,
      status,
      assignee_id,
      search,
      page = 1,
      limit = 20,
    } = query;

    if (group_id) {
      await this.assertGroupExists(group_id);
      await this.assertCanViewGroup(group_id, userId);
    }

    const qb = this.taskRepository
      .createQueryBuilder('task')
      .innerJoin('task.group', 'group')
      .innerJoin(
        'group.members',
        'viewerMembership',
        'viewerMembership.user_id = :userId AND viewerMembership.left_at IS NULL',
        { userId },
      )
      .leftJoin('task.assignee', 'assignee')
      .where('task.deleted_at IS NULL');

    if (group_id) {
      qb.andWhere('task.group_id = :groupId', { groupId: group_id });
    }
    if (status) {
      qb.andWhere('task.status = :status', { status });
    }
    if (assignee_id) {
      qb.andWhere('task.assignee_id = :assigneeId', {
        assigneeId: assignee_id,
      });
    }
    if (search) {
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('LOWER(task.title) LIKE LOWER(:search)', {
              search: `%${search}%`,
            })
            .orWhere(
              "LOWER(COALESCE(task.description, '')) LIKE LOWER(:search)",
              {
                search: `%${search}%`,
              },
            );
        }),
      );
    }

    qb.select([
      'task.id',
      'task.group_id',
      'task.title',
      'task.description',
      'task.status',
      'task.priority',
      'task.assignee_id',
      'task.due_at',
      'task.jira_issue_key',
      'task.jira_issue_id',
      'task.jira_sync_status',
      'task.jira_sync_reason',
      'task.created_at',
      'task.updated_at',
      'assignee.id',
      'assignee.full_name',
      'assignee.email',
    ])
      .orderBy('task.updated_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [tasks, total] = await qb.getManyAndCount();

    return {
      data: tasks.map((task) => this.toTaskResponse(task)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async create(userId: string, userRole: Role, dto: CreateTaskDto) {
    const group = await this.assertGroupExists(dto.group_id);
    await this.assertCanManageGroup(dto.group_id, userId, userRole);
    await this.assertAssigneeInGroup(dto.group_id, dto.assignee_id);
    await this.assertJiraAssignableAssignee(group, userId, dto.assignee_id);

    const status = this.normalizeStatus(
      dto.status || TaskStatus.TODO,
      dto.assignee_id || null,
    );

    const task = this.taskRepository.create({
      group_id: dto.group_id,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      status,
      priority: dto.priority || TaskPriority.MEDIUM,
      assignee_id: dto.assignee_id || null,
      due_at: dto.due_at ? new Date(dto.due_at) : null,
      created_by_id: userId,
      jira_sync_status: group.jira_project_key
        ? TaskJiraSyncStatus.FAILED
        : TaskJiraSyncStatus.SKIPPED,
      jira_sync_reason: group.jira_project_key ? null : 'NO_PROJECT_KEY',
    });

    const savedTask = await this.taskRepository.save(task);
    await this.syncTaskToJira(userId, group, savedTask);
    this.logTaskAction('create', userId, dto.group_id, savedTask.id);
    return this.getTaskForViewer(savedTask.id, userId);
  }

  async update(
    taskId: string,
    userId: string,
    userRole: Role,
    dto: UpdateTaskDto,
  ) {
    const task = await this.getTaskOrThrow(taskId);
    const group = await this.assertGroupExists(task.group_id);
    await this.assertCanViewGroup(task.group_id, userId);

    if (dto.group_id && dto.group_id !== task.group_id) {
      throw new BadRequestException('Changing task group is not supported.');
    }

    if (dto.assignee_id !== undefined) {
      await this.assertAssigneeInGroup(task.group_id, dto.assignee_id);
      await this.assertJiraAssignableAssignee(group, userId, dto.assignee_id);
    }

    const allowedAsMember = await this.memberCanUpdate(
      task,
      userId,
      userRole,
      dto,
    );
    if (!allowedAsMember) {
      await this.assertCanManageGroup(task.group_id, userId, userRole);
    }

    const previousTaskState = { ...task } as Task;
    const nextTaskState = Object.assign(task, {
      title: dto.title !== undefined ? dto.title.trim() : task.title,
      description:
        dto.description !== undefined
          ? dto.description?.trim() || null
          : task.description,
      status: this.normalizeStatus(
        dto.status ?? task.status,
        dto.assignee_id !== undefined
          ? dto.assignee_id || null
          : task.assignee_id,
      ),
      priority: dto.priority ?? task.priority,
      assignee_id:
        dto.assignee_id !== undefined
          ? dto.assignee_id || null
          : task.assignee_id,
      due_at:
        dto.due_at !== undefined
          ? dto.due_at
            ? new Date(dto.due_at)
            : null
          : task.due_at,
    });

    if (group.jira_project_key) {
      await this.syncJiraLinkedTaskUpdate(
        userId,
        group,
        previousTaskState,
        nextTaskState,
        dto,
      );
    } else {
      nextTaskState.jira_sync_status = TaskJiraSyncStatus.SKIPPED;
      nextTaskState.jira_sync_reason = 'NO_PROJECT_KEY';
    }

    const updatedTask = await this.taskRepository.save(nextTaskState);
    this.logTaskAction('update', userId, task.group_id, task.id);
    return this.getTaskForViewer(updatedTask.id, userId);
  }

  async remove(taskId: string, userId: string, userRole: Role) {
    const task = await this.getTaskOrThrow(taskId);
    await this.assertCanViewGroup(task.group_id, userId);
    await this.assertCanManageGroup(task.group_id, userId, userRole);

    task.deleted_at = new Date();
    await this.taskRepository.save(task);
    this.logTaskAction('delete', userId, task.group_id, task.id);
  }

  private async getTaskForViewer(taskId: string, userId: string) {
    const task = await this.taskRepository
      .createQueryBuilder('task')
      .innerJoin('task.group', 'group')
      .innerJoin(
        'group.members',
        'viewerMembership',
        'viewerMembership.user_id = :userId AND viewerMembership.left_at IS NULL',
        { userId },
      )
      .leftJoinAndSelect('task.assignee', 'assignee')
      .where('task.id = :taskId', { taskId })
      .andWhere('task.deleted_at IS NULL')
      .getOne();

    if (!task) {
      throw new NotFoundException(ERROR_MESSAGES.TASKS.NOT_FOUND);
    }

    return this.toTaskResponse(task);
  }

  private toTaskResponse(task: Task) {
    return {
      id: task.id,
      key: task.jira_issue_key || null,
      jira_issue_key: task.jira_issue_key || null,
      group_id: task.group_id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignee_id: task.assignee_id || null,
      assignee_name: task.assignee?.full_name || task.assignee?.email || null,
      jira_sync_status: task.jira_sync_status ?? TaskJiraSyncStatus.SKIPPED,
      jira_sync_reason: task.jira_sync_reason ?? null,
      due_at: task.due_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  private async memberCanUpdate(
    task: Task,
    userId: string,
    userRole: Role,
    dto: UpdateTaskDto,
  ): Promise<boolean> {
    if (userRole === Role.ADMIN) {
      return false;
    }

    const membership = await this.membershipRepository.findOne({
      where: { group_id: task.group_id, user_id: userId, left_at: IsNull() },
    });

    if (!membership || membership.role_in_group === MembershipRole.LEADER) {
      return false;
    }

    if (task.assignee_id === userId) {
      return (
        dto.status !== undefined &&
        dto.assignee_id === undefined &&
        dto.title === undefined &&
        dto.description === undefined &&
        dto.priority === undefined &&
        dto.due_at === undefined &&
        dto.group_id === undefined
      );
    }

    if (!task.assignee_id && task.status === TaskStatus.TODO) {
      return (
        dto.assignee_id === userId &&
        dto.status === undefined &&
        dto.title === undefined &&
        dto.description === undefined &&
        dto.priority === undefined &&
        dto.due_at === undefined &&
        dto.group_id === undefined
      );
    }

    return false;
  }

  private async getTaskOrThrow(taskId: string) {
    const task = await this.taskRepository.findOne({
      where: { id: taskId, deleted_at: IsNull() },
    });
    if (!task) {
      throw new NotFoundException(ERROR_MESSAGES.TASKS.NOT_FOUND);
    }
    return task;
  }

  private async assertGroupExists(groupId: string) {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException(ERROR_MESSAGES.TASKS.GROUP_NOT_FOUND);
    }
    return group;
  }

  private normalizeStatus(status: TaskStatus, assigneeId: string | null) {
    if (status === TaskStatus.DONE || status === TaskStatus.BLOCKED) {
      return status;
    }

    if (assigneeId) {
      return TaskStatus.IN_PROGRESS;
    }

    return TaskStatus.TODO;
  }

  private async getJiraAccountIdByUserId(userId?: string | null) {
    if (!userId) {
      return null;
    }

    const jiraToken = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.JIRA },
      select: { provider_user_id: true },
    });

    return jiraToken?.provider_user_id || null;
  }

  private async getRequiredJiraAccountId(userId: string, message: string) {
    const jiraAccountId = await this.getJiraAccountIdByUserId(userId);

    if (jiraAccountId) {
      return jiraAccountId;
    }

    throw createIntegrationException(HttpStatus.UNAUTHORIZED, {
      code: 'JIRA_ACCOUNT_NOT_LINKED',
      provider: IntegrationProvider.JIRA,
      message,
      reconnectRequired: true,
    });
  }

  private mapJiraTaskActionError(
    error: unknown,
    fallbackCode: 'JIRA_ASSIGN_FAILED' | 'JIRA_TRANSITION_FAILED',
    fallbackMessage: string,
  ): never {
    const body = this.getIntegrationErrorBody(error);

    if (body?.code === 'TOKEN_EXPIRED' || body?.code === 'ACCOUNT_NOT_LINKED') {
      throw createIntegrationException(HttpStatus.UNAUTHORIZED, {
        code: 'JIRA_ACCOUNT_NOT_LINKED',
        provider: IntegrationProvider.JIRA,
        message:
          'Your Jira account is not linked or needs to be reconnected before performing this action.',
        reconnectRequired: true,
        details: body?.details,
      });
    }

    if (body?.code === 'INSUFFICIENT_SCOPE') {
      throw createIntegrationException(HttpStatus.FORBIDDEN, {
        code: 'JIRA_MEMBERSHIP_REQUIRED',
        provider: IntegrationProvider.JIRA,
        message:
          'You must be a member of the linked Jira project team to update this task.',
        details: body?.details,
      });
    }

    throw createIntegrationException(HttpStatus.BAD_REQUEST, {
      code: fallbackCode,
      provider: IntegrationProvider.JIRA,
      message: fallbackMessage,
      details: body?.details,
    });
  }

  private async assertExplicitJiraProjectMembership(
    actorUserId: string,
    projectKey: string,
    candidateUserId: string,
    candidateLabel: 'actor' | 'assignee',
  ) {
    const jiraAccountId = await this.getRequiredJiraAccountId(
      candidateUserId,
      candidateLabel === 'actor'
        ? 'Your Jira account is not linked or needs to be reconnected before performing this action.'
        : 'The selected assignee must link a Jira account before this task can be synced.',
    );

    const isMember = await this.jiraService.isExplicitProjectMember(
      actorUserId,
      projectKey,
      jiraAccountId,
    );

    if (!isMember) {
      throw createIntegrationException(HttpStatus.FORBIDDEN, {
        code: 'JIRA_MEMBERSHIP_REQUIRED',
        provider: IntegrationProvider.JIRA,
        message:
          candidateLabel === 'actor'
            ? 'You must be a member of the linked Jira project team to update this task.'
            : 'The selected assignee must belong to the linked Jira project team.',
      });
    }

    return jiraAccountId;
  }

  private async resolveSyncUserId(groupId: string, requestingUserId: string): Promise<string | null> {
    // Use requesting user's token if available
    const ownToken = await this.integrationTokenRepository.findOne({
      where: { user_id: requestingUserId, provider: IntegrationProvider.JIRA },
      select: { access_token: true },
    });
    if (ownToken?.access_token) return requestingUserId;

    // Fallback: use leader's token
    const leaderMembership = await this.membershipRepository.findOne({
      where: { group_id: groupId, role_in_group: MembershipRole.LEADER, left_at: IsNull() },
    });
    if (!leaderMembership) return null;

    const leaderToken = await this.integrationTokenRepository.findOne({
      where: { user_id: leaderMembership.user_id, provider: IntegrationProvider.JIRA },
      select: { access_token: true },
    });
    return leaderToken?.access_token ? leaderMembership.user_id : null;
  }

  private async syncTaskToJira(userId: string, group: Group, task: Task) {
    if (!group.jira_project_key) {
      await this.taskRepository.update(
        { id: task.id },
        {
          jira_sync_status: TaskJiraSyncStatus.SKIPPED,
          jira_sync_reason: 'NO_PROJECT_KEY',
        },
      );
      return;
    }

    const syncUserId = await this.resolveSyncUserId(group.id, userId);
    if (!syncUserId) {
      this.logger.warn(
        JSON.stringify({
          event: 'task_jira_sync_skipped',
          group_id: group.id,
          task_id: task.id,
          reason: 'no_jira_token_available',
        }),
      );
      return;
    }

    // Step 1: create issue if not yet linked — save key immediately
    let issueKey = task.jira_issue_key || null;
    let issueId = task.jira_issue_id || null;

    if (!issueKey) {
      try {
        const createdIssue = await this.jiraService.createIssue(syncUserId, {
          projectKey: group.jira_project_key,
          summary: task.title,
          description: task.description,
        });
        issueKey = createdIssue.key;
        issueId = createdIssue.id;
        await this.taskRepository.update(
          { id: task.id },
          {
            jira_issue_key: issueKey,
            jira_issue_id: issueId,
          },
        );
      } catch (error: unknown) {
        const body = this.getIntegrationErrorBody(error);
        this.logger.warn(
          JSON.stringify({
            event: 'task_jira_create_failed',
            group_id: group.id,
            task_id: task.id,
            jira_sync_reason:
              body?.code ||
              (error instanceof Error ? error.message : 'createIssue failed'),
          }),
        );
        await this.taskRepository.update(
          { id: task.id },
          {
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: body?.code || 'JIRA_SYNC_FAILED',
          },
        );
        return;
      }
    }

    // Step 2: assign — fail gracefully
    const jiraAssigneeAccountId = await this.getJiraAccountIdByUserId(task.assignee_id);
    if (jiraAssigneeAccountId) {
      try {
        await this.jiraService.assignIssue(syncUserId, issueKey, jiraAssigneeAccountId);
      } catch (error: unknown) {
        const body = this.getIntegrationErrorBody(error);
        this.logger.warn(
          JSON.stringify({
            event: 'task_jira_assign_failed',
            group_id: group.id,
            task_id: task.id,
            issue_key: issueKey,
            jira_sync_reason:
              body?.code ||
              (error instanceof Error ? error.message : 'assignIssue failed'),
          }),
        );
        await this.taskRepository.update(
          { id: task.id },
          {
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: body?.code || 'JIRA_SYNC_FAILED',
          },
        );
      }
    }

    // Step 3: transition — fail gracefully, independent of assign
    try {
      const transitioned = await this.jiraService.transitionIssue(
        syncUserId,
        issueKey,
        task.status,
      );
      if (!transitioned) {
        await this.taskRepository.update(
          { id: task.id },
          {
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: 'JIRA_SYNC_FAILED',
          },
        );
        return;
      }
    } catch (error: unknown) {
      const body = this.getIntegrationErrorBody(error);
      this.logger.warn(
        JSON.stringify({
          event: 'task_jira_transition_failed',
          group_id: group.id,
          task_id: task.id,
          issue_key: issueKey,
          status: task.status,
          jira_sync_reason:
            body?.code ||
            (error instanceof Error ? error.message : 'transitionIssue failed'),
        }),
      );
      await this.taskRepository.update(
        { id: task.id },
        {
          jira_sync_status: TaskJiraSyncStatus.FAILED,
          jira_sync_reason: body?.code || 'JIRA_SYNC_FAILED',
        },
      );
      return;
    }

    await this.taskRepository.update(
      { id: task.id },
      {
        jira_sync_status: TaskJiraSyncStatus.SUCCESS,
        jira_sync_reason: null,
      },
    );
  }

  private async syncJiraLinkedTaskUpdate(
    actorUserId: string,
    group: Group,
    previousTaskState: Task,
    nextTaskState: Task,
    dto: UpdateTaskDto,
  ) {
    const projectKey = group.jira_project_key;
    if (!projectKey) {
      nextTaskState.jira_sync_status = TaskJiraSyncStatus.SKIPPED;
      nextTaskState.jira_sync_reason = 'NO_PROJECT_KEY';
      return;
    }

    const isClaimOrReassign = dto.assignee_id !== undefined;
    const isStatusChange = dto.status !== undefined;

    if (!isClaimOrReassign && !isStatusChange) {
      nextTaskState.jira_sync_status =
        previousTaskState.jira_sync_status ?? TaskJiraSyncStatus.SKIPPED;
      nextTaskState.jira_sync_reason = previousTaskState.jira_sync_reason ?? null;
      return;
    }

    await this.assertExplicitJiraProjectMembership(
      actorUserId,
      projectKey,
      actorUserId,
      'actor',
    );

    let jiraAssigneeAccountId: string | null = null;
    if (nextTaskState.assignee_id) {
      jiraAssigneeAccountId = await this.assertExplicitJiraProjectMembership(
        actorUserId,
        projectKey,
        nextTaskState.assignee_id,
        'assignee',
      );
    }

    let issueKey = previousTaskState.jira_issue_key || null;
    let issueId = previousTaskState.jira_issue_id || null;

    if (!issueKey) {
      try {
        const createdIssue = await this.jiraService.createIssue(actorUserId, {
          projectKey,
          summary: nextTaskState.title,
          description: nextTaskState.description,
        });
        issueKey = createdIssue.key;
        issueId = createdIssue.id;
      } catch (error) {
        await this.taskRepository.update(
          { id: previousTaskState.id },
          {
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: 'JIRA_ASSIGN_FAILED',
          },
        );
        this.mapJiraTaskActionError(
          error,
          'JIRA_ASSIGN_FAILED',
          'Failed to synchronize Jira assignee for this task.',
        );
      }
    }

    if (
      jiraAssigneeAccountId &&
      (isClaimOrReassign || !previousTaskState.jira_issue_key)
    ) {
      try {
        await this.jiraService.assignIssue(
          actorUserId,
          issueKey as string,
          jiraAssigneeAccountId,
        );
      } catch (error) {
        await this.taskRepository.update(
          { id: previousTaskState.id },
          {
            jira_issue_key: issueKey,
            jira_issue_id: issueId,
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: 'JIRA_ASSIGN_FAILED',
          },
        );
        this.mapJiraTaskActionError(
          error,
          'JIRA_ASSIGN_FAILED',
          'Failed to synchronize Jira assignee for this task.',
        );
      }
    }

    if (isStatusChange) {
      try {
        const transitioned = await this.jiraService.transitionIssue(
          actorUserId,
          issueKey as string,
          nextTaskState.status,
        );

        if (!transitioned) {
          throw createIntegrationException(HttpStatus.BAD_REQUEST, {
            code: 'JIRA_TRANSITION_FAILED',
            provider: IntegrationProvider.JIRA,
            message: 'Failed to synchronize Jira status for this task.',
          });
        }
      } catch (error) {
        await this.taskRepository.update(
          { id: previousTaskState.id },
          {
            jira_issue_key: issueKey,
            jira_issue_id: issueId,
            jira_sync_status: TaskJiraSyncStatus.FAILED,
            jira_sync_reason: 'JIRA_TRANSITION_FAILED',
          },
        );
        this.mapJiraTaskActionError(
          error,
          'JIRA_TRANSITION_FAILED',
          'Failed to synchronize Jira status for this task.',
        );
      }
    }

    nextTaskState.jira_issue_key = issueKey;
    nextTaskState.jira_issue_id = issueId;
    nextTaskState.jira_sync_status = TaskJiraSyncStatus.SUCCESS;
    nextTaskState.jira_sync_reason = null;
  }

  private async assertCanViewGroup(groupId: string, userId: string) {
    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: userId, left_at: IsNull() },
    });

    if (!membership) {
      throw new ForbiddenException(ERROR_MESSAGES.TASKS.FORBIDDEN_READ);
    }

    return membership;
  }

  private async assertCanManageGroup(
    groupId: string,
    userId: string,
    userRole: Role,
  ) {
    if (userRole === Role.ADMIN) {
      return;
    }

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: userId, left_at: IsNull() },
    });

    if (!membership || membership.role_in_group !== MembershipRole.LEADER) {
      throw new ForbiddenException(ERROR_MESSAGES.TASKS.FORBIDDEN_WRITE);
    }
  }

  private async assertAssigneeInGroup(
    groupId: string,
    assigneeId?: string | null,
  ) {
    if (!assigneeId) {
      return;
    }

    const membership = await this.membershipRepository.findOne({
      where: { group_id: groupId, user_id: assigneeId, left_at: IsNull() },
    });

    if (!membership) {
      throw new BadRequestException(ERROR_MESSAGES.TASKS.ASSIGNEE_NOT_IN_GROUP);
    }

    const user = await this.userRepository.findOne({
      where: { id: assigneeId },
    });
    if (!user) {
      throw new BadRequestException(ERROR_MESSAGES.TASKS.ASSIGNEE_NOT_IN_GROUP);
    }
  }

  private async assertJiraAssignableAssignee(
    group: Group,
    requestingUserId: string,
    assigneeId?: string | null,
  ) {
    if (!group.jira_project_key || !assigneeId) {
      return;
    }

    const jiraAssigneeAccountId = await this.getJiraAccountIdByUserId(assigneeId);
    if (!jiraAssigneeAccountId) {
      throw new BadRequestException(
        'Assignee must link Jira account before being assigned in a Jira-synced group.',
      );
    }

    const syncUserId = await this.resolveSyncUserId(group.id, requestingUserId);
    if (!syncUserId) {
      throw new BadRequestException(
        'No Jira account available to validate assignment for this group.',
      );
    }

    const assignable = await this.jiraService.isAccountAssignableInProject(
      syncUserId,
      group.jira_project_key,
      jiraAssigneeAccountId,
    );

    if (!assignable) {
      throw new BadRequestException(
        `Selected user is not assignable in Jira project ${group.jira_project_key}.`,
      );
    }
  }

  private logTaskAction(
    action: 'create' | 'update' | 'delete',
    actorUserId: string,
    groupId: string,
    taskId: string,
  ) {
    this.logger.log(
      JSON.stringify({
        event: 'task_write',
        action,
        actor_user_id: actorUserId,
        group_id: groupId,
        task_id: taskId,
      }),
    );
  }
}
