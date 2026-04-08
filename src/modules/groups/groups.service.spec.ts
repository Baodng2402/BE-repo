import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Class,
  ClassMembership,
  Group,
  GroupMembership,
  GroupRepository,
  GroupStatus,
  IntegrationToken,
  MembershipRole,
  Role,
  Topic,
  User,
} from '../../entities';
import { GithubService } from '../github/github.service';
import { JiraService } from '../jira/jira.service';
import { GroupsService } from './groups.service';

// ── Test fixtures ────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const THIRD_USER_ID = '33333333-3333-3333-3333-333333333333';
const GROUP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TARGET_GROUP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TARGET_GROUP_ID_2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const LECTURER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const NOW = new Date('2026-02-23T00:00:00Z');

const mockUser = {
  id: USER_ID,
  full_name: 'Nguyen Van A',
  email: 'a@fpt.edu.vn',
  avatar_url: null,
};

const mockOtherUser = {
  id: OTHER_USER_ID,
  full_name: 'Tran Thi B',
  email: 'b@fpt.edu.vn',
  avatar_url: null,
};

const mockClass = {
  id: CLASS_ID,
  lecturer_id: LECTURER_ID,
  max_groups: 7,
  max_students_per_group: 5,
  semester: 'HK2-2025',
};

const mockGroup = {
  id: GROUP_ID,
  name: 'Group Alpha',
  project_name: 'E-Commerce Platform',
  description: 'Building an e-commerce app',
  semester: 'HK2-2025',
  status: 'ACTIVE',
  class_id: CLASS_ID,
  github_repo_url: 'https://github.com/org/repo',
  jira_project_key: 'ECOM',
  created_by_id: USER_ID,
  created_at: NOW,
  updated_at: NOW,
};

const mockTargetGroup = {
  id: TARGET_GROUP_ID,
  name: 'Group Beta',
  status: GroupStatus.ACTIVE,
  class_id: CLASS_ID,
};

const mockTargetGroup2 = {
  id: TARGET_GROUP_ID_2,
  name: 'Group Gamma',
  status: GroupStatus.ACTIVE,
  class_id: CLASS_ID,
};

const mockMembership = {
  group_id: GROUP_ID,
  user_id: USER_ID,
  role_in_group: 'LEADER',
  joined_at: NOW,
  left_at: null,
};

const mockGroupWithMembers = {
  ...mockGroup,
  members: [{ ...mockMembership, user: mockUser }],
};

// ── Mock Repositories ───────────────────────────────────

function createMockGroupRepository() {
  const qb = {
    distinct: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getExists: jest.fn(),
    loadRelationCountAndMap: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  return {
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    exist: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
    _qb: qb,
  };
}

function createMockMembershipRepository() {
  return {
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function createMockClassMembershipRepository() {
  return {
    find: jest.fn(),
  };
}

function createMockUserRepository() {
  return {
    findOne: jest.fn(),
  };
}

function createMockGroupRepoRepository() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

function createMockIntegrationTokenRepository() {
  return {
    findOne: jest.fn(),
  };
}

function createMockClassRepository() {
  return {
    findOne: jest.fn(),
  };
}

function createMockDataSource() {
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  return {
    transaction: jest.fn((cb) => {
      const manager = {
        update: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn((_Entity, data) => data),
        save: jest.fn((data) => data),
        createQueryBuilder: jest.fn(() => qb),
      };
      return cb(manager);
    }),
  };
}

// ── Tests ────────────────────────────────────────────────

describe('GroupsService', () => {
  let service: GroupsService;
  let groupRepo: ReturnType<typeof createMockGroupRepository>;
  let membershipRepo: ReturnType<typeof createMockMembershipRepository>;
  let classMembershipRepo: ReturnType<
    typeof createMockClassMembershipRepository
  >;
  let userRepo: ReturnType<typeof createMockUserRepository>;
  let groupRepositoryRepo: ReturnType<typeof createMockGroupRepoRepository>;
  let integrationTokenRepo: ReturnType<
    typeof createMockIntegrationTokenRepository
  >;
  let githubService: { validateRepositoryAccess: jest.Mock };
  let jiraService: { validateProjectAccess: jest.Mock };
  let classRepo: ReturnType<typeof createMockClassRepository>;
  let dataSource: ReturnType<typeof createMockDataSource>;

  beforeEach(async () => {
    groupRepo = createMockGroupRepository();
    membershipRepo = createMockMembershipRepository();
    classMembershipRepo = createMockClassMembershipRepository();
    userRepo = createMockUserRepository();
    groupRepositoryRepo = createMockGroupRepoRepository();
    integrationTokenRepo = createMockIntegrationTokenRepository();
    classRepo = createMockClassRepository();
    dataSource = createMockDataSource();
    githubService = { validateRepositoryAccess: jest.fn() };
    jiraService = { validateProjectAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getRepositoryToken(Group), useValue: groupRepo },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: membershipRepo,
        },
        {
          provide: getRepositoryToken(ClassMembership),
          useValue: classMembershipRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Topic), useValue: {} },
        {
          provide: getRepositoryToken(GroupRepository),
          useValue: groupRepositoryRepo,
        },
        {
          provide: getRepositoryToken(IntegrationToken),
          useValue: integrationTokenRepo,
        },
        { provide: getRepositoryToken(Class), useValue: classRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: GithubService, useValue: githubService },
        { provide: JiraService, useValue: jiraService },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ───────────────────────────────────────────

  describe('create', () => {
    const dto = {
      class_id: CLASS_ID,
      name: 'Group Alpha',
      project_name: 'E-Commerce Platform',
      description: 'Building an e-commerce app',
      semester: 'HK2-2025',
    };

    it('should create a group for ADMIN with class-scoped validation', async () => {
      classRepo.findOne.mockResolvedValue(mockClass);
      groupRepo.count.mockResolvedValue(0);
      groupRepo._qb.getExists.mockResolvedValue(false);
      groupRepo.save.mockResolvedValue(mockGroup);
      // findOneById via createQueryBuilder
      groupRepo._qb.getOne.mockResolvedValue({ ...mockGroup, members: [] });

      const result = await service.create(USER_ID, Role.ADMIN, dto);

      expect(classRepo.findOne).toHaveBeenCalledWith({
        where: { id: CLASS_ID },
      });
      expect(groupRepo.save).toHaveBeenCalled();
      expect(membershipRepo.save).not.toHaveBeenCalled();
      expect(result.id).toBe(GROUP_ID);
      expect(result.members).toHaveLength(0);
    });
  });

  // ── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(() => {
      groupRepo._qb.getManyAndCount.mockResolvedValue([
        [{ ...mockGroup, members_count: 3 }],
        1,
      ]);
    });

    it('should call innerJoin for STUDENT role', async () => {
      await service.findAll(USER_ID, Role.STUDENT, {});
      expect(groupRepo._qb.innerJoin).toHaveBeenCalled();
    });

    it('should call innerJoin for GROUP_LEADER role', async () => {
      await service.findAll(USER_ID, Role.GROUP_LEADER, {});
      expect(groupRepo._qb.innerJoin).toHaveBeenCalled();
    });

    it('should NOT call innerJoin for LECTURER role', async () => {
      await service.findAll(USER_ID, Role.LECTURER, {});
      expect(groupRepo._qb.innerJoin).not.toHaveBeenCalled();
    });

    it('should NOT call innerJoin for ADMIN role', async () => {
      await service.findAll(USER_ID, Role.ADMIN, {});
      expect(groupRepo._qb.innerJoin).not.toHaveBeenCalled();
    });

    it('should apply semester and status filters', async () => {
      await service.findAll(USER_ID, Role.ADMIN, {
        semester: 'HK2-2025',
        status: GroupStatus.ACTIVE,
      });
      expect(groupRepo._qb.andWhere).toHaveBeenCalledWith(
        'group.semester = :semester',
        { semester: 'HK2-2025' },
      );
      expect(groupRepo._qb.andWhere).toHaveBeenCalledWith(
        'group.status = :status',
        { status: GroupStatus.ACTIVE },
      );
    });

    it('should apply search filter', async () => {
      await service.findAll(USER_ID, Role.ADMIN, { search: 'Alpha' });
      // andWhere is called with a Brackets instance for search
      expect(groupRepo._qb.andWhere).toHaveBeenCalled();
    });

    it('should return paginated response with correct meta', async () => {
      groupRepo._qb.getManyAndCount.mockResolvedValue([
        [{ ...mockGroup, members_count: 3 }],
        45,
      ]);

      const result = await service.findAll(USER_ID, Role.ADMIN, {
        page: 2,
        limit: 20,
      });

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        total_pages: 3,
      });
      expect(groupRepo._qb.skip).toHaveBeenCalledWith(20);
      expect(groupRepo._qb.take).toHaveBeenCalledWith(20);
    });

    it('should map members_count from loaded count', async () => {
      const result = await service.findAll(USER_ID, Role.ADMIN, {});
      expect(result.data[0].members_count).toBe(3);
    });
  });

  // ── findOne ──────────────────────────────────────────

  describe('findOne', () => {
    it('should return group detail for a member', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(GROUP_ID, USER_ID, Role.STUDENT);

      expect(result.id).toBe(GROUP_ID);
      expect(result.jira_project_key).toBe('ECOM');
      expect(result.members).toHaveLength(1);
      expect(result.members_count).toBe(1);
    });

    it('should throw ForbiddenException for non-member student', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      await expect(
        service.findOne(GROUP_ID, OTHER_USER_ID, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow LECTURER to view any group', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(
        GROUP_ID,
        OTHER_USER_ID,
        Role.LECTURER,
      );

      expect(result.id).toBe(GROUP_ID);
    });

    it('should allow ADMIN to view any group', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(GROUP_ID, OTHER_USER_ID, Role.ADMIN);

      expect(result.id).toBe(GROUP_ID);
    });

    it('should throw NotFoundException for non-existent group', async () => {
      groupRepo._qb.getOne.mockResolvedValue(null);

      await expect(
        service.findOne('bad-id', USER_ID, Role.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────

  describe('update', () => {
    const dto = { name: 'Updated Name' };

    it('should update group when user is leader', async () => {
      // assertGroupExists
      groupRepo.findOne.mockResolvedValue(mockGroup);
      // assertCanManageGroup
      membershipRepo.findOne.mockResolvedValue(mockMembership);
      groupRepo.update.mockResolvedValue({ affected: 1 });
      // findOneById after update
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      const result = await service.update(GROUP_ID, USER_ID, Role.STUDENT, dto);

      expect(groupRepo.update).toHaveBeenCalledWith({ id: GROUP_ID }, dto);
      expect(result.id).toBe(GROUP_ID);
    });

    it('should allow ADMIN to update any group', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      groupRepo.update.mockResolvedValue({ affected: 1 });
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      const result = await service.update(
        GROUP_ID,
        OTHER_USER_ID,
        Role.ADMIN,
        dto,
      );

      expect(result.id).toBe(GROUP_ID);
    });

    it('should throw ForbiddenException for non-leader', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });

      await expect(
        service.update(GROUP_ID, OTHER_USER_ID, Role.STUDENT, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for non-existent group', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('bad-id', USER_ID, Role.ADMIN, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate Jira project key before saving', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMembership);
      jiraService.validateProjectAccess.mockResolvedValue({ key: 'NEWKEY' });
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);

      await service.update(GROUP_ID, USER_ID, Role.STUDENT, {
        jira_project_key: 'NEWKEY',
      });

      expect(jiraService.validateProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        'NEWKEY',
      );
      expect(groupRepo.update).toHaveBeenCalledWith(
        { id: GROUP_ID },
        expect.objectContaining({ jira_project_key: 'NEWKEY' }),
      );
    });
  });

  // ── remove ───────────────────────────────────────────

  describe('remove', () => {
    it('should delete memberships then group', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.delete.mockResolvedValue({ affected: 2 });
      groupRepo.delete.mockResolvedValue({ affected: 1 });

      await service.remove(GROUP_ID, USER_ID, Role.ADMIN);

      expect(membershipRepo.delete).toHaveBeenCalledWith({
        group_id: GROUP_ID,
      });
      expect(groupRepo.delete).toHaveBeenCalledWith({
        id: GROUP_ID,
      });
    });

    it('should throw NotFoundException for non-existent group', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.remove('bad-id', USER_ID, Role.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findMembers ──────────────────────────────────────

  describe('findMembers', () => {
    it('should return formatted member list', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.find.mockResolvedValue([
        { ...mockMembership, user: mockUser },
      ]);

      const result = await service.findMembers(GROUP_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: USER_ID,
        full_name: 'Nguyen Van A',
        email: 'a@fpt.edu.vn',
        avatar_url: null,
        role_in_group: 'LEADER',
        joined_at: NOW,
      });
    });

    it('should throw NotFoundException for non-existent group', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(service.findMembers('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── addMember ────────────────────────────────────────

  describe('addMember', () => {
    const dto = { user_id: OTHER_USER_ID };

    beforeEach(() => {
      // assertGroupExists
      groupRepo.findOne.mockResolvedValue(mockGroup);
      // assertCanManageGroup (leader)
      membershipRepo.findOne.mockResolvedValueOnce(mockMembership);
      // user exists
      userRepo.findOne.mockResolvedValue(mockOtherUser);
    });

    it('should add a new member', async () => {
      // no existing membership
      membershipRepo.findOne.mockResolvedValueOnce(null);
      membershipRepo.save.mockResolvedValue({});
      // findMembers call
      membershipRepo.find.mockResolvedValue([
        { ...mockMembership, user: mockUser },
        {
          group_id: GROUP_ID,
          user_id: OTHER_USER_ID,
          role_in_group: 'MEMBER',
          joined_at: NOW,
          left_at: null,
          user: mockOtherUser,
        },
      ]);

      const result = await service.addMember(
        GROUP_ID,
        dto,
        USER_ID,
        Role.STUDENT,
      );

      expect(membershipRepo.save).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('should re-add a previously removed member', async () => {
      // existing membership with left_at set
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
        left_at: NOW,
      });
      membershipRepo.update.mockResolvedValue({ affected: 1 });
      membershipRepo.find.mockResolvedValue([]);

      await service.addMember(GROUP_ID, dto, USER_ID, Role.STUDENT);

      expect(membershipRepo.update).toHaveBeenCalledWith(
        { group_id: GROUP_ID, user_id: OTHER_USER_ID },
        expect.objectContaining({ left_at: null }),
      );
    });

    it('should throw BadRequestException for duplicate active member', async () => {
      // existing active membership
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
        left_at: null,
      });

      await expect(
        service.addMember(GROUP_ID, dto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      membershipRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.addMember(GROUP_ID, dto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when requester is not leader', async () => {
      membershipRepo.findOne.mockReset();
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });

      await expect(
        service.addMember(GROUP_ID, dto, OTHER_USER_ID, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── updateMember ─────────────────────────────────────

  describe('updateMember', () => {
    const dto = { role_in_group: MembershipRole.LEADER };

    beforeEach(() => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      // assertCanManageGroup → leader
      membershipRepo.findOne.mockResolvedValueOnce(mockMembership);
    });

    it('should update member role', async () => {
      // target membership lookup
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });
      membershipRepo.find.mockResolvedValue([]);

      await service.updateMember(
        GROUP_ID,
        OTHER_USER_ID,
        dto,
        USER_ID,
        Role.STUDENT,
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(membershipRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-member', async () => {
      membershipRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateMember(
          GROUP_ID,
          OTHER_USER_ID,
          dto,
          USER_ID,
          Role.STUDENT,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for soft-removed member', async () => {
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        left_at: NOW,
      });

      await expect(
        service.updateMember(
          GROUP_ID,
          OTHER_USER_ID,
          dto,
          USER_ID,
          Role.STUDENT,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeMember ─────────────────────────────────────

  describe('removeMember', () => {
    beforeEach(() => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      // assertCanManageGroup → leader
      membershipRepo.findOne.mockResolvedValueOnce(mockMembership);
    });

    it('should soft-remove a MEMBER', async () => {
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });
      membershipRepo.update.mockResolvedValue({ affected: 1 });

      await service.removeMember(
        GROUP_ID,
        OTHER_USER_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(membershipRepo.update).toHaveBeenCalledWith(
        { group_id: GROUP_ID, user_id: OTHER_USER_ID },
        { left_at: expect.any(Date) },
      );
    });

    it('should allow removing a LEADER when multiple leaders exist', async () => {
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'LEADER',
      });
      membershipRepo.count.mockResolvedValue(2);
      membershipRepo.update.mockResolvedValue({ affected: 1 });

      await service.removeMember(
        GROUP_ID,
        OTHER_USER_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(membershipRepo.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when removing the last leader', async () => {
      membershipRepo.findOne.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'LEADER',
      });
      membershipRepo.count.mockResolvedValue(1);

      await expect(
        service.removeMember(GROUP_ID, OTHER_USER_ID, USER_ID, Role.STUDENT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-member', async () => {
      membershipRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeMember(GROUP_ID, OTHER_USER_ID, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── leaveGroup ───────────────────────────────────────

  describe('leaveGroup', () => {
    it('should soft-remove the user from the group', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue({
        ...mockMembership,
        role_in_group: 'MEMBER',
      });
      membershipRepo.update.mockResolvedValue({ affected: 1 });

      await service.leaveGroup(GROUP_ID, USER_ID);

      expect(membershipRepo.update).toHaveBeenCalledWith(
        { group_id: GROUP_ID, user_id: USER_ID },
        { left_at: expect.any(Date) },
      );
    });

    it('should allow a leader to leave when other leaders exist', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMembership);
      membershipRepo.count.mockResolvedValue(2);
      membershipRepo.update.mockResolvedValue({ affected: 1 });

      await service.leaveGroup(GROUP_ID, USER_ID);

      expect(membershipRepo.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when last leader tries to leave', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMembership);
      membershipRepo.count.mockResolvedValue(1);

      await expect(service.leaveGroup(GROUP_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when user is not a member', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(null);

      await expect(service.leaveGroup(GROUP_ID, OTHER_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when user was soft-removed', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue({
        ...mockMembership,
        left_at: NOW,
      });

      await expect(service.leaveGroup(GROUP_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addGroupRepo', () => {
    beforeEach(() => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      membershipRepo.findOne.mockResolvedValue(mockMembership);
    });

    it('should validate repo access before linking', async () => {
      groupRepositoryRepo.findOne.mockResolvedValue(null);
      githubService.validateRepositoryAccess.mockResolvedValue({
        name: 'repo',
        full_name: 'org/repo',
        html_url: 'https://github.com/org/repo',
      });
      groupRepositoryRepo.save.mockResolvedValue({
        id: 'repo-id',
        repo_name: 'repo',
      });

      await service.addGroupRepo(GROUP_ID, USER_ID, Role.STUDENT, {
        repo_url: 'https://github.com/org/repo',
        repo_name: 'repo',
        repo_owner: 'org',
      });

      expect(githubService.validateRepositoryAccess).toHaveBeenCalledWith(
        USER_ID,
        'org',
        'repo',
      );
      expect(groupRepositoryRepo.save).toHaveBeenCalled();
    });
  });

  describe('getIntegrationStatus', () => {
    it('should return user + group integration readiness', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);
      integrationTokenRepo.findOne
        .mockResolvedValueOnce({
          provider_username: 'octocat',
          provider_email: 'octo@example.com',
        })
        .mockResolvedValueOnce(null);
      groupRepositoryRepo.find.mockResolvedValue([
        {
          id: 'repo-id',
          repo_owner: 'org',
          repo_name: 'repo',
          repo_url: 'https://github.com/org/repo',
          is_primary: true,
        },
      ]);

      const result = await service.getIntegrationStatus(
        GROUP_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(result.user.github.linked).toBe(true);
      expect(result.user.jira.linked).toBe(false);
      expect(result.group.linkedReposCount).toBe(1);
      expect(result.warnings).toContain(
        'Jira account is not linked for the current user.',
      );
    });
  });

  describe('getIntegrationMappings', () => {
    it('should return jira key and linked repo mapping', async () => {
      groupRepo._qb.getOne.mockResolvedValue(mockGroupWithMembers);
      groupRepositoryRepo.find.mockResolvedValue([
        {
          id: 'repo-id',
          repo_url: 'https://github.com/org/repo',
          repo_name: 'repo',
          repo_owner: 'org',
          is_primary: true,
        },
      ]);

      const result = await service.getIntegrationMappings(
        GROUP_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(result.jira_project_key).toBe('ECOM');
      expect(result.github_repositories).toHaveLength(1);
      expect(result.github_repositories[0].repo_name).toBe('repo');
    });
  });

  // ── reassignMembers ─────────────────────────────────

  describe('reassignMembers', () => {
    const leaderMembership = {
      group_id: GROUP_ID,
      user_id: USER_ID,
      role_in_group: MembershipRole.LEADER,
      joined_at: NOW,
      left_at: null,
    };
    const memberMembership = {
      group_id: GROUP_ID,
      user_id: OTHER_USER_ID,
      role_in_group: MembershipRole.MEMBER,
      joined_at: NOW,
      left_at: null,
    };

    const baseDto = {
      assignments: [
        { user_id: OTHER_USER_ID, target_group_id: TARGET_GROUP_ID },
      ],
      archive_source: false,
    };

    // Helper to set up the happy-path mocks
    function setupHappyPath() {
      // assertGroupExists
      groupRepo.findOne.mockResolvedValue(mockGroup);
      // classRepository.findOne (called twice: auth check + max check)
      classRepo.findOne.mockResolvedValue(mockClass);
      // active members of source group
      membershipRepo.find.mockResolvedValue([
        leaderMembership,
        memberMembership,
      ]);
      // target groups lookup
      groupRepo.find.mockResolvedValue([mockTargetGroup]);
      // count current members in target group
      membershipRepo.createQueryBuilder = jest.fn(() => {
        const qb = {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest
            .fn()
            .mockResolvedValue([{ group_id: TARGET_GROUP_ID, count: 3 }]),
        };
        return qb;
      });
      // check member not already in target group
      membershipRepo.findOne.mockResolvedValue(null);
    }

    it('should reassign members successfully (partial move)', async () => {
      setupHappyPath();

      const result = await service.reassignMembers(
        GROUP_ID,
        baseDto,
        LECTURER_ID,
        Role.LECTURER,
      );

      expect(result).toEqual({
        message: 'Members reassigned successfully',
        archived: false,
        reassigned_count: 1,
        remaining_count: 1,
      });
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should reassign all members and archive source group', async () => {
      setupHappyPath();
      const dto = {
        assignments: [
          { user_id: USER_ID, target_group_id: TARGET_GROUP_ID },
          { user_id: OTHER_USER_ID, target_group_id: TARGET_GROUP_ID_2 },
        ],
        archive_source: true,
      };
      // Two target groups
      groupRepo.find.mockResolvedValue([mockTargetGroup, mockTargetGroup2]);
      membershipRepo.createQueryBuilder = jest.fn(() => {
        const qb = {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([
            { group_id: TARGET_GROUP_ID, count: 2 },
            { group_id: TARGET_GROUP_ID_2, count: 3 },
          ]),
        };
        return qb;
      });

      const result = await service.reassignMembers(
        GROUP_ID,
        dto,
        LECTURER_ID,
        Role.LECTURER,
      );

      expect(result.archived).toBe(true);
      expect(result.reassigned_count).toBe(2);
      expect(result.remaining_count).toBe(0);
    });

    it('should allow ADMIN regardless of class ownership', async () => {
      setupHappyPath();

      const result = await service.reassignMembers(
        GROUP_ID,
        baseDto,
        'some-admin-id',
        Role.ADMIN,
      );

      expect(result.reassigned_count).toBe(1);
    });

    it('should throw BadRequest if source group has no class_id', async () => {
      groupRepo.findOne.mockResolvedValue({ ...mockGroup, class_id: null });

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw Forbidden if requester is not the class lecturer', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      classRepo.findOne.mockResolvedValue({
        ...mockClass,
        lecturer_id: 'someone-else',
      });

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequest for duplicate user_ids in assignments', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      classRepo.findOne.mockResolvedValue(mockClass);
      membershipRepo.find.mockResolvedValue([
        leaderMembership,
        memberMembership,
      ]);

      const dto = {
        assignments: [
          { user_id: OTHER_USER_ID, target_group_id: TARGET_GROUP_ID },
          { user_id: OTHER_USER_ID, target_group_id: TARGET_GROUP_ID_2 },
        ],
      };

      await expect(
        service.reassignMembers(GROUP_ID, dto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest if user_id is not an active member', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      classRepo.findOne.mockResolvedValue(mockClass);
      membershipRepo.find.mockResolvedValue([leaderMembership]);

      const dto = {
        assignments: [
          { user_id: THIRD_USER_ID, target_group_id: TARGET_GROUP_ID },
        ],
      };

      await expect(
        service.reassignMembers(GROUP_ID, dto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest when moving last leader while members remain', async () => {
      groupRepo.findOne.mockResolvedValue(mockGroup);
      classRepo.findOne.mockResolvedValue(mockClass);
      membershipRepo.find.mockResolvedValue([
        leaderMembership,
        memberMembership,
      ]);

      // Try to move the leader out, leaving the member behind
      const dto = {
        assignments: [{ user_id: USER_ID, target_group_id: TARGET_GROUP_ID }],
      };

      await expect(
        service.reassignMembers(GROUP_ID, dto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow moving last leader when no members remain', async () => {
      // Only the leader in the group
      groupRepo.findOne.mockResolvedValue(mockGroup);
      classRepo.findOne.mockResolvedValue(mockClass);
      membershipRepo.find.mockResolvedValue([leaderMembership]);
      groupRepo.find.mockResolvedValue([mockTargetGroup]);
      membershipRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ group_id: TARGET_GROUP_ID, count: 2 }]),
      }));
      membershipRepo.findOne.mockResolvedValue(null);

      const dto = {
        assignments: [{ user_id: USER_ID, target_group_id: TARGET_GROUP_ID }],
      };

      const result = await service.reassignMembers(
        GROUP_ID,
        dto,
        LECTURER_ID,
        Role.LECTURER,
      );

      expect(result.remaining_count).toBe(0);
      expect(result.reassigned_count).toBe(1);
    });

    it('should throw BadRequest when archive_source but members remain', async () => {
      setupHappyPath();
      const dto = { ...baseDto, archive_source: true };

      await expect(
        service.reassignMembers(GROUP_ID, dto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFound if target group does not exist', async () => {
      setupHappyPath();
      groupRepo.find.mockResolvedValue([]); // no target groups found

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest if target group is not ACTIVE', async () => {
      setupHappyPath();
      groupRepo.find.mockResolvedValue([
        { ...mockTargetGroup, status: GroupStatus.ARCHIVED },
      ]);

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest if target group is in a different class', async () => {
      setupHappyPath();
      groupRepo.find.mockResolvedValue([
        { ...mockTargetGroup, class_id: 'different-class-id' },
      ]);

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest if target group would exceed max members', async () => {
      setupHappyPath();
      // Target group already has 5 members (at max)
      membershipRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ group_id: TARGET_GROUP_ID, count: 5 }]),
      }));

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest if member is already active in target group', async () => {
      setupHappyPath();
      // Member already active in target
      membershipRepo.findOne.mockResolvedValue({
        group_id: TARGET_GROUP_ID,
        user_id: OTHER_USER_ID,
        left_at: null,
      });

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent source group', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reassignMembers(GROUP_ID, baseDto, LECTURER_ID, Role.LECTURER),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
