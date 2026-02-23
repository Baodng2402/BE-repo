import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { GroupsService } from './groups.service';
import { PrismaService } from '../../prisma/prisma.service';

// ── Test fixtures ────────────────────────────────────────

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
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

const mockGroup = {
  id: GROUP_ID,
  name: 'Group Alpha',
  project_name: 'E-Commerce Platform',
  description: 'Building an e-commerce app',
  semester: 'HK2-2025',
  status: 'ACTIVE',
  github_repo_url: 'https://github.com/org/repo',
  jira_project_key: 'ECOM',
  created_by_id: USER_ID,
  created_at: NOW,
  updated_at: NOW,
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

// ── Mock PrismaService ───────────────────────────────────

function createMockPrisma() {
  return {
    group: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    groupMembership: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
}

// ── Tests ────────────────────────────────────────────────

describe('GroupsService', () => {
  let service: GroupsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: prisma },
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
      name: 'Group Alpha',
      project_name: 'E-Commerce Platform',
      description: 'Building an e-commerce app',
      semester: 'HK2-2025',
    };

    it('should create a group and add creator as LEADER', async () => {
      prisma.group.create.mockResolvedValue(mockGroup);
      prisma.groupMembership.create.mockResolvedValue(mockMembership);
      // findOneById call
      prisma.group.findUnique.mockResolvedValue(mockGroupWithMembers);

      const result = await service.create(USER_ID, dto);

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: dto.name,
          created_by_id: USER_ID,
        }),
      });
      expect(prisma.groupMembership.create).toHaveBeenCalledWith({
        data: {
          group_id: GROUP_ID,
          user_id: USER_ID,
          role_in_group: 'LEADER',
        },
      });
      expect(result.id).toBe(GROUP_ID);
      expect(result.members).toHaveLength(1);
      expect(result.members[0].role_in_group).toBe('LEADER');
    });
  });

  // ── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    const groupWithCount = {
      ...mockGroup,
      _count: { members: 3 },
    };

    beforeEach(() => {
      prisma.group.findMany.mockResolvedValue([groupWithCount]);
      prisma.group.count.mockResolvedValue(1);
    });

    it('should filter groups by membership for STUDENT role', async () => {
      await service.findAll(USER_ID, Role.STUDENT, {});

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.members).toEqual({
        some: { user_id: USER_ID, left_at: null },
      });
    });

    it('should filter groups by membership for GROUP_LEADER role', async () => {
      await service.findAll(USER_ID, Role.GROUP_LEADER, {});

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.members).toBeDefined();
    });

    it('should return all groups for LECTURER role', async () => {
      await service.findAll(USER_ID, Role.LECTURER, {});

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.members).toBeUndefined();
    });

    it('should return all groups for ADMIN role', async () => {
      await service.findAll(USER_ID, Role.ADMIN, {});

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.members).toBeUndefined();
    });

    it('should apply semester and status filters', async () => {
      await service.findAll(USER_ID, Role.ADMIN, {
        semester: 'HK2-2025',
        status: 'ACTIVE',
      });

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.semester).toBe('HK2-2025');
      expect(whereArg.status).toBe('ACTIVE');
    });

    it('should apply search filter on name and project_name', async () => {
      await service.findAll(USER_ID, Role.ADMIN, { search: 'Alpha' });

      const whereArg = prisma.group.findMany.mock.calls[0][0].where;
      expect(whereArg.OR).toEqual([
        { name: { contains: 'Alpha', mode: 'insensitive' } },
        { project_name: { contains: 'Alpha', mode: 'insensitive' } },
      ]);
    });

    it('should return paginated response with correct meta', async () => {
      prisma.group.count.mockResolvedValue(45);

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
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('should map members_count from _count.members', async () => {
      const result = await service.findAll(USER_ID, Role.ADMIN, {});

      expect(result.data[0].members_count).toBe(3);
    });
  });

  // ── findOne ──────────────────────────────────────────

  describe('findOne', () => {
    it('should return group detail for a member', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(GROUP_ID, USER_ID, Role.STUDENT);

      expect(result.id).toBe(GROUP_ID);
      expect(result.members).toHaveLength(1);
      expect(result.members_count).toBe(1);
    });

    it('should throw ForbiddenException for non-member student', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroupWithMembers);

      await expect(
        service.findOne(GROUP_ID, OTHER_USER_ID, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow LECTURER to view any group', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(
        GROUP_ID,
        OTHER_USER_ID,
        Role.LECTURER,
      );

      expect(result.id).toBe(GROUP_ID);
    });

    it('should allow ADMIN to view any group', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroupWithMembers);

      const result = await service.findOne(
        GROUP_ID,
        OTHER_USER_ID,
        Role.ADMIN,
      );

      expect(result.id).toBe(GROUP_ID);
    });

    it('should throw NotFoundException for non-existent group', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

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
      prisma.group.findUnique
        .mockResolvedValueOnce(mockGroup)
        // assertCanManageGroup → findUnique on membership
        // (handled by groupMembership.findUnique below)
        // findOneById after update
        .mockResolvedValueOnce(mockGroupWithMembers);

      prisma.groupMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.group.update.mockResolvedValue({ ...mockGroup, ...dto });

      const result = await service.update(
        GROUP_ID,
        USER_ID,
        Role.STUDENT,
        dto,
      );

      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: GROUP_ID },
        data: dto,
      });
      expect(result.id).toBe(GROUP_ID);
    });

    it('should allow ADMIN to update any group', async () => {
      prisma.group.findUnique
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce(mockGroupWithMembers);
      prisma.group.update.mockResolvedValue(mockGroup);

      // ADMIN skips membership check
      const result = await service.update(
        GROUP_ID,
        OTHER_USER_ID,
        Role.ADMIN,
        dto,
      );

      expect(result.id).toBe(GROUP_ID);
    });

    it('should throw ForbiddenException for non-leader', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });

      await expect(
        service.update(GROUP_ID, OTHER_USER_ID, Role.STUDENT, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for non-existent group', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.update('bad-id', USER_ID, Role.ADMIN, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────

  describe('remove', () => {
    it('should delete memberships then group', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.deleteMany.mockResolvedValue({ count: 2 });
      prisma.group.delete.mockResolvedValue(mockGroup);

      await service.remove(GROUP_ID);

      expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
        where: { group_id: GROUP_ID },
      });
      expect(prisma.group.delete).toHaveBeenCalledWith({
        where: { id: GROUP_ID },
      });
    });

    it('should throw NotFoundException for non-existent group', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.remove('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findMembers ──────────────────────────────────────

  describe('findMembers', () => {
    it('should return formatted member list', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findMany.mockResolvedValue([
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
      prisma.group.findUnique.mockResolvedValue(null);

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
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      // assertCanManageGroup (leader)
      prisma.groupMembership.findUnique.mockResolvedValueOnce(mockMembership);
      // user exists
      prisma.user.findUnique.mockResolvedValue(mockOtherUser);
    });

    it('should add a new member', async () => {
      // no existing membership
      prisma.groupMembership.findUnique.mockResolvedValueOnce(null);
      prisma.groupMembership.create.mockResolvedValue({});
      // findMembers call
      prisma.groupMembership.findMany.mockResolvedValue([
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

      expect(prisma.groupMembership.create).toHaveBeenCalledWith({
        data: {
          group_id: GROUP_ID,
          user_id: OTHER_USER_ID,
          role_in_group: 'MEMBER',
        },
      });
      expect(result).toHaveLength(2);
    });

    it('should re-add a previously removed member', async () => {
      // existing membership with left_at set
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
        left_at: NOW,
      });
      prisma.groupMembership.update.mockResolvedValue({});
      prisma.groupMembership.findMany.mockResolvedValue([]);

      await service.addMember(GROUP_ID, dto, USER_ID, Role.STUDENT);

      expect(prisma.groupMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ left_at: null }),
        }),
      );
    });

    it('should throw BadRequestException for duplicate active member', async () => {
      // existing active membership
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
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
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.groupMembership.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addMember(GROUP_ID, dto, USER_ID, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when requester is not leader', async () => {
      // Override the first findUnique for assertCanManageGroup to return MEMBER
      prisma.groupMembership.findUnique.mockReset();
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
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
    const dto = { role_in_group: 'LEADER' as const };

    beforeEach(() => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      // assertCanManageGroup → leader
      prisma.groupMembership.findUnique.mockResolvedValueOnce(mockMembership);
    });

    it('should update member role', async () => {
      // target membership lookup
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });
      prisma.groupMembership.update.mockResolvedValue({});
      prisma.groupMembership.findMany.mockResolvedValue([]);

      await service.updateMember(
        GROUP_ID,
        OTHER_USER_ID,
        dto,
        USER_ID,
        Role.STUDENT,
      );

      expect(prisma.groupMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role_in_group: 'LEADER' },
        }),
      );
    });

    it('should throw NotFoundException for non-member', async () => {
      prisma.groupMembership.findUnique.mockResolvedValueOnce(null);

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
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
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
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      // assertCanManageGroup → leader
      prisma.groupMembership.findUnique.mockResolvedValueOnce(mockMembership);
    });

    it('should soft-remove a MEMBER', async () => {
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'MEMBER',
      });
      prisma.groupMembership.update.mockResolvedValue({});

      await service.removeMember(
        GROUP_ID,
        OTHER_USER_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(prisma.groupMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { left_at: expect.any(Date) },
        }),
      );
    });

    it('should allow removing a LEADER when multiple leaders exist', async () => {
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'LEADER',
      });
      prisma.groupMembership.count.mockResolvedValue(2);
      prisma.groupMembership.update.mockResolvedValue({});

      await service.removeMember(
        GROUP_ID,
        OTHER_USER_ID,
        USER_ID,
        Role.STUDENT,
      );

      expect(prisma.groupMembership.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when removing the last leader', async () => {
      prisma.groupMembership.findUnique.mockResolvedValueOnce({
        ...mockMembership,
        user_id: OTHER_USER_ID,
        role_in_group: 'LEADER',
      });
      prisma.groupMembership.count.mockResolvedValue(1);

      await expect(
        service.removeMember(
          GROUP_ID,
          OTHER_USER_ID,
          USER_ID,
          Role.STUDENT,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-member', async () => {
      prisma.groupMembership.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.removeMember(
          GROUP_ID,
          OTHER_USER_ID,
          USER_ID,
          Role.STUDENT,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── leaveGroup ───────────────────────────────────────

  describe('leaveGroup', () => {
    it('should soft-remove the user from the group', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        role_in_group: 'MEMBER',
      });
      prisma.groupMembership.update.mockResolvedValue({});

      await service.leaveGroup(GROUP_ID, USER_ID);

      expect(prisma.groupMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { left_at: expect.any(Date) },
        }),
      );
    });

    it('should allow a leader to leave when other leaders exist', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.groupMembership.count.mockResolvedValue(2);
      prisma.groupMembership.update.mockResolvedValue({});

      await service.leaveGroup(GROUP_ID, USER_ID);

      expect(prisma.groupMembership.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when last leader tries to leave', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue(mockMembership);
      prisma.groupMembership.count.mockResolvedValue(1);

      await expect(service.leaveGroup(GROUP_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when user is not a member', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.leaveGroup(GROUP_ID, OTHER_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user was soft-removed', async () => {
      prisma.group.findUnique.mockResolvedValue(mockGroup);
      prisma.groupMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        left_at: NOW,
      });

      await expect(service.leaveGroup(GROUP_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
