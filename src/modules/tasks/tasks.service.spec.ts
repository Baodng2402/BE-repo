import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  MembershipRole,
  Role,
  TaskPriority,
  TaskStatus,
} from '../../common/enums';
import { Group, GroupMembership, Task, User } from '../../entities';
import { IntegrationToken } from '../../entities/integration-token.entity';
import { JiraService } from '../jira/jira.service';
import { TasksService } from './tasks.service';

function createMockRepository() {
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getOne: jest.fn(),
  };

  return {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
    _qb: qb,
  };
}

describe('TasksService', () => {
  let service: TasksService;
  let taskRepo: ReturnType<typeof createMockRepository>;
  let groupRepo: ReturnType<typeof createMockRepository>;
  let membershipRepo: ReturnType<typeof createMockRepository>;
  let userRepo: ReturnType<typeof createMockRepository>;
  let integrationTokenRepo: ReturnType<typeof createMockRepository>;
  const jiraService = {
    createIssue: jest.fn(),
    assignIssue: jest.fn(),
    isAccountAssignableInProject: jest.fn(),
    isExplicitProjectMember: jest.fn(),
    transitionIssue: jest.fn(),
  };

  const groupId = '11111111-1111-1111-1111-111111111111';
  const leaderId = '22222222-2222-2222-2222-222222222222';
  const memberId = '33333333-3333-3333-3333-333333333333';
  const outsiderId = '44444444-4444-4444-4444-444444444444';
  const taskId = '55555555-5555-5555-5555-555555555555';

  beforeEach(async () => {
    taskRepo = createMockRepository();
    groupRepo = createMockRepository();
    membershipRepo = createMockRepository();
    userRepo = createMockRepository();
    integrationTokenRepo = createMockRepository();
    jest.clearAllMocks();

    taskRepo.save.mockImplementation(async (entity) => ({
      id: entity.id ?? taskId,
      created_at: entity.created_at ?? new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T10:00:00.000Z'),
      ...entity,
    }));
    taskRepo.update.mockResolvedValue({ affected: 1 });
    jiraService.createIssue.mockReset();
    jiraService.assignIssue.mockReset();
    jiraService.isAccountAssignableInProject.mockReset();
    jiraService.isExplicitProjectMember.mockReset();
    jiraService.transitionIssue.mockReset();
    jiraService.createIssue.mockResolvedValue({ id: '10010', key: 'SWP-10' });
    jiraService.assignIssue.mockResolvedValue(undefined);
    jiraService.isAccountAssignableInProject.mockResolvedValue(true);
    jiraService.isExplicitProjectMember.mockResolvedValue(true);
    jiraService.transitionIssue.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: membershipRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(IntegrationToken),
          useValue: integrationTokenRepo,
        },
        { provide: JiraService, useValue: jiraService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('creates a task for a leader and returns mobile contract', async () => {
    groupRepo.findOne.mockResolvedValue({ id: groupId });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });
    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });
    taskRepo._qb.getOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Prepare mobile payload',
      description: 'Return task DTO',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
      due_at: new Date('2026-03-25T10:00:00.000Z'),
      created_at: new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T10:00:00.000Z'),
      assignee: {
        id: memberId,
        full_name: 'Member A',
        email: 'member@fpt.edu.vn',
      },
    });

    const result = await service.create(leaderId, Role.STUDENT, {
      group_id: groupId,
      title: 'Prepare mobile payload',
      description: 'Return task DTO',
      assignee_id: memberId,
      due_at: '2026-03-25T10:00:00.000Z',
      priority: TaskPriority.HIGH,
      status: TaskStatus.TODO,
    });

    expect(result).toMatchObject({
      id: taskId,
      group_id: groupId,
      assignee_name: 'Member A',
      priority: TaskPriority.HIGH,
      status: TaskStatus.TODO,
    });
  });

  it('rejects task creation for non-leader members', async () => {
    groupRepo.findOne.mockResolvedValue({ id: groupId });
    membershipRepo.findOne.mockResolvedValue({
      group_id: groupId,
      user_id: memberId,
      role_in_group: MembershipRole.MEMBER,
      left_at: null,
    });

    await expect(
      service.create(memberId, Role.STUDENT, {
        group_id: groupId,
        title: 'No permission',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects assignee outside the group', async () => {
    groupRepo.findOne.mockResolvedValue({ id: groupId });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.create(leaderId, Role.STUDENT, {
        group_id: groupId,
        title: 'Bad assignee',
        assignee_id: outsiderId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates a task after validating permission and assignee', async () => {
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: null,
    });
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Old title',
      description: null,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee_id: null,
      due_at: null,
      created_by_id: leaderId,
      deleted_at: null,
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      });
    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });
    taskRepo._qb.getOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Updated title',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      due_at: null,
      created_at: new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T11:00:00.000Z'),
      assignee: {
        id: memberId,
        full_name: 'Member A',
        email: 'member@fpt.edu.vn',
      },
    });

    const result = await service.update(taskId, leaderId, Role.STUDENT, {
      title: 'Updated title',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      assignee_id: memberId,
    });

    expect(result.title).toBe('Updated title');
    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    expect(result.priority).toBe(TaskPriority.URGENT);
  });

  it('soft deletes a task', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      deleted_at: null,
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      });

    await service.remove(taskId, leaderId, Role.STUDENT);

    expect(taskRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: taskId,
        deleted_at: expect.any(Date),
      }),
    );
  });

  it('lists tasks with status/search filters and pagination meta', async () => {
    groupRepo.findOne.mockResolvedValue({ id: groupId });
    membershipRepo.findOne.mockResolvedValue({
      group_id: groupId,
      user_id: memberId,
      role_in_group: MembershipRole.MEMBER,
      left_at: null,
    });
    taskRepo._qb.getManyAndCount.mockResolvedValue([
      [
        {
          id: taskId,
          group_id: groupId,
          title: 'Searchable task',
          description: 'Contains API keyword',
          status: TaskStatus.DONE,
          priority: TaskPriority.MEDIUM,
          assignee: { full_name: 'Member A', email: 'member@fpt.edu.vn' },
          created_at: new Date('2026-03-20T10:00:00.000Z'),
          updated_at: new Date('2026-03-20T11:00:00.000Z'),
        },
      ],
      1,
    ]);

    const result = await service.findAll(memberId, {
      group_id: groupId,
      status: TaskStatus.DONE,
      search: 'API',
      page: 2,
      limit: 5,
    });

    expect(taskRepo._qb.andWhere).toHaveBeenCalledWith(
      'task.status = :status',
      {
        status: TaskStatus.DONE,
      },
    );
    expect(taskRepo._qb.skip).toHaveBeenCalledWith(5);
    expect(taskRepo._qb.take).toHaveBeenCalledWith(5);
    expect(result.meta).toEqual({
      total: 1,
      page: 2,
      limit: 5,
      total_pages: 1,
    });
    expect(result.data[0].title).toBe('Searchable task');
  });

  it('throws not found when requested group does not exist', async () => {
    groupRepo.findOne.mockResolvedValue(null);

    await expect(
      service.findAll(memberId, { group_id: groupId }),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows member to change status of own assigned task', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Own task',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      due_at: null,
      deleted_at: null,
    });

    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });

    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: null,
    });

    taskRepo.save.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Own task',
      description: null,
      status: TaskStatus.DONE,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      due_at: null,
      deleted_at: null,
    });

    taskRepo._qb.getOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Own task',
      description: null,
      status: TaskStatus.DONE,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      assignee: {
        id: memberId,
        full_name: 'Member A',
        email: 'member@fpt.edu.vn',
      },
      created_at: new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T11:00:00.000Z'),
    });

    const result = await service.update(taskId, memberId, Role.STUDENT, {
      status: TaskStatus.DONE,
    });

    expect(result.status).toBe(TaskStatus.DONE);
    expect(result.assignee_id).toBe(memberId);
  });

  it('allows member to claim unassigned TODO task', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee_id: null,
      due_at: null,
      deleted_at: null,
    });

    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });

    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });

    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: null,
    });

    taskRepo.save.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      due_at: null,
      deleted_at: null,
    });

    taskRepo._qb.getOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      assignee: {
        id: memberId,
        full_name: 'Member A',
        email: 'member@fpt.edu.vn',
      },
      created_at: new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T11:00:00.000Z'),
    });

    const result = await service.update(taskId, memberId, Role.STUDENT, {
      assignee_id: memberId,
    });

    expect(result.assignee_id).toBe(memberId);
    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });

  it('rejects member updating fields outside allowed claim/status actions', async () => {
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: null,
    });

    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Own task',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      due_at: null,
      deleted_at: null,
    });

    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });

    await expect(
      service.update(taskId, memberId, Role.STUDENT, {
        status: TaskStatus.DONE,
        title: 'Should not be allowed',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects claim in Jira-linked group when actor is not explicit Jira project member', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee_id: null,
      jira_issue_key: 'SWP-11',
      jira_issue_id: '10011',
      jira_sync_status: 'SUCCESS',
      jira_sync_reason: null,
      due_at: null,
      deleted_at: null,
    });
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: 'SWP',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });
    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });
    integrationTokenRepo.findOne
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' })
      .mockResolvedValueOnce({ access_token: 'token' })
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' });
    jiraService.isExplicitProjectMember.mockResolvedValue(false);

    await expect(
      service.update(taskId, memberId, Role.STUDENT, {
        assignee_id: memberId,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'JIRA_MEMBERSHIP_REQUIRED',
      }),
      status: 403,
    });

    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('returns stable assign error when Jira assignee sync fails', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee_id: null,
      jira_issue_key: 'SWP-12',
      jira_issue_id: '10012',
      jira_sync_status: 'SUCCESS',
      jira_sync_reason: null,
      due_at: null,
      deleted_at: null,
    });
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: 'SWP',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: leaderId,
        role_in_group: MembershipRole.LEADER,
        left_at: null,
      });
    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });
    integrationTokenRepo.findOne
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' })
      .mockResolvedValueOnce({ access_token: 'leader-token' })
      .mockResolvedValueOnce({ provider_user_id: 'jira-leader-1' })
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' });
    jiraService.assignIssue.mockRejectedValue(
      new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Cannot assign issue',
        },
        400,
      ),
    );

    await expect(
      service.update(taskId, leaderId, Role.STUDENT, {
        assignee_id: memberId,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'JIRA_ASSIGN_FAILED',
      }),
      status: 400,
    });

    expect(taskRepo.update).toHaveBeenCalledWith(
      { id: taskId },
      expect.objectContaining({
        jira_sync_status: 'FAILED',
        jira_sync_reason: 'JIRA_ASSIGN_FAILED',
      }),
    );
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('returns stable transition error when Jira status sync fails', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Own task',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      jira_issue_key: 'SWP-13',
      jira_issue_id: '10013',
      jira_sync_status: 'SUCCESS',
      jira_sync_reason: null,
      due_at: null,
      deleted_at: null,
    });
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: 'SWP',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });
    integrationTokenRepo.findOne.mockResolvedValue({ provider_user_id: 'jira-member-1' });
    jiraService.transitionIssue.mockRejectedValue(
      new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Cannot transition issue',
        },
        400,
      ),
    );

    await expect(
      service.update(taskId, memberId, Role.STUDENT, {
        status: TaskStatus.DONE,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'JIRA_TRANSITION_FAILED',
      }),
      status: 400,
    });

    expect(taskRepo.update).toHaveBeenCalledWith(
      { id: taskId },
      expect.objectContaining({
        jira_sync_status: 'FAILED',
        jira_sync_reason: 'JIRA_TRANSITION_FAILED',
      }),
    );
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('synchronizes claim update for explicit Jira members in linked groups', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assignee_id: null,
      jira_issue_key: null,
      jira_issue_id: null,
      jira_sync_status: 'FAILED',
      jira_sync_reason: null,
      due_at: null,
      deleted_at: null,
    });
    groupRepo.findOne.mockResolvedValue({
      id: groupId,
      jira_project_key: 'SWP',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      })
      .mockResolvedValueOnce({
        group_id: groupId,
        user_id: memberId,
        role_in_group: MembershipRole.MEMBER,
        left_at: null,
      });
    userRepo.findOne.mockResolvedValue({
      id: memberId,
      full_name: 'Member A',
      email: 'member@fpt.edu.vn',
    });
    integrationTokenRepo.findOne
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' })
      .mockResolvedValueOnce({ access_token: 'member-token' })
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' })
      .mockResolvedValueOnce({ provider_user_id: 'jira-member-1' });
    jiraService.createIssue.mockResolvedValue({
      id: '10014',
      key: 'SWP-14',
    });
    taskRepo._qb.getOne.mockResolvedValue({
      id: taskId,
      group_id: groupId,
      title: 'Claim me',
      description: null,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.MEDIUM,
      assignee_id: memberId,
      jira_issue_key: 'SWP-14',
      jira_sync_status: 'SUCCESS',
      jira_sync_reason: null,
      assignee: {
        id: memberId,
        full_name: 'Member A',
        email: 'member@fpt.edu.vn',
      },
      created_at: new Date('2026-03-20T10:00:00.000Z'),
      updated_at: new Date('2026-03-20T11:00:00.000Z'),
    });

    const result = await service.update(taskId, memberId, Role.STUDENT, {
      assignee_id: memberId,
    });

    expect(jiraService.createIssue).toHaveBeenCalledWith(memberId, {
      projectKey: 'SWP',
      summary: 'Claim me',
      description: null,
    });
    expect(jiraService.assignIssue).toHaveBeenCalledWith(
      memberId,
      'SWP-14',
      'jira-member-1',
    );
    expect(result.jira_sync_status).toBe('SUCCESS');
    expect(result.jira_issue_key).toBe('SWP-14');
  });
});
