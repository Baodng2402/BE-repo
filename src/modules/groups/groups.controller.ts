import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../entities';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { QueryGroupsDto } from './dto/query-groups.dto';
import { ReassignMembersDto } from './dto/reassign-members.dto';
import { UpdateClassMemberCapacityDto } from './dto/update-class-member-capacity.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import {
  GroupDetailEntity,
  GroupMemberEntity,
  PaginatedGroupsEntity,
  ReassignMembersResponseEntity,
} from './entities/group.entity';
import { GroupsService } from './groups.service';

@ApiTags('Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // ── Group CRUD ─────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new group (lecturer of class or admin)' })
  @ApiResponse({ status: 201, type: GroupDetailEntity })
  async create(@Req() req: AuthorizedRequest, @Body() dto: CreateGroupDto) {
    return await this.groupsService.create(
      req.user.id,
      req.user.role as Role,
      dto,
    );
  }

  @Get()
  @ApiOperation({
    summary: '[Step 1] Get my joined groups and my role in each group',
    description:
      'For STUDENT/GROUP_LEADER: returns only groups you joined. Use my_role_in_group=LEADER to know whether you can create/update/delete tasks.',
  })
  @ApiResponse({ status: 200, type: PaginatedGroupsEntity })
  async findAll(@Req() req: AuthorizedRequest, @Query() query: QueryGroupsDto) {
    return await this.groupsService.findAll(
      req.user.id,
      req.user.role as Role,
      query,
    );
  }

  @Get('class/:classId')
  @ApiOperation({
    summary: '[Step 2] Get available groups in a class before joining one',
    description:
      'Use this when you already know classId and need to choose a group to join.',
  })
  async getGroupsByClass(
    @Req() req: AuthorizedRequest,
    @Param('classId') classId: string,
  ) {
    return await this.groupsService.getGroupsByClass(
      classId,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get('class/:classId/ungrouped-students')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary: 'List students in class that are not assigned to any active group',
  })
  async getUngroupedStudentsByClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.getUngroupedStudentsByClass(
      classId,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Patch('class/:classId/member-capacity')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Update max students per group for a class (class lecturer or admin)',
  })
  async updateClassMemberCapacity(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: UpdateClassMemberCapacityDto,
  ) {
    return this.groupsService.updateClassMemberCapacity(
      classId,
      dto.max_students_per_group,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Post(':id/join')
  @ApiOperation({
    summary: '[Step 3] Join group (first member becomes LEADER)',
  })
  async joinEmptyGroup(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return await this.groupsService.joinEmptyGroup(id, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group details with members' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: GroupDetailEntity })
  @ApiResponse({ status: 403, description: 'Not a member of this group' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.findOne(id, req.user.id, req.user.role as Role);
  }

  @Get(':id/integration-status')
  @ApiOperation({
    summary:
      '[Step 4] Verify Jira/GitHub readiness before creating Jira-linked tasks',
  })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  async getIntegrationStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.getIntegrationStatus(
      id,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get(':id/integrations')
  @ApiOperation({
    summary: 'Get integration mappings for the group',
  })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  async getIntegrationMappings(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.getIntegrationMappings(
      id,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update group info (leader, lecturer of class, or admin)',
  })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: GroupDetailEntity })
  @ApiResponse({
    status: 403,
    description: 'Only group leaders, class lecturer, or admin can update',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(
      id,
      req.user.id,
      req.user.role as Role,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group (lecturer of class or admin)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 204, description: 'Group deleted' })
  @ApiResponse({ status: 403, description: 'Lecturer/admin access required' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.remove(id, req.user.id, req.user.role as Role);
  }

  // ── Member management ──────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'List active members of a group' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: [GroupMemberEntity] })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async findMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.findMembers(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to the group (leader or admin)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 201, type: [GroupMemberEntity] })
  @ApiResponse({ status: 400, description: 'User already a member' })
  @ApiResponse({
    status: 403,
    description: 'Only group leaders can add members',
  })
  @ApiResponse({ status: 404, description: 'Group or user not found' })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: AddMemberDto,
  ) {
    return this.groupsService.addMember(
      id,
      dto,
      req.user.id,
      req.user.role as Role,
    );
  }

  // Static "/me" route must come before parametric "/:userId" routes
  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Leave a group voluntarily' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 204, description: 'Left the group' })
  @ApiResponse({ status: 400, description: 'Cannot leave as last leader' })
  @ApiResponse({ status: 404, description: 'Not a member of this group' })
  async leaveGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.leaveGroup(id, req.user.id);
  }

  @Post(':id/reassign-members')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Reassign members from a group to other groups (lecturer or admin)',
    description:
      'Moves a subset (or all) of active members from the source group into other target groups within the same class. Optionally archives the source group if emptied.',
  })
  @ApiParam({ name: 'id', description: 'Source group UUID to reassign from' })
  @ApiResponse({
    status: 200,
    description: 'Members reassigned successfully',
    type: ReassignMembersResponseEntity,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (max exceeded, leader protection, etc.)',
  })
  @ApiResponse({ status: 403, description: 'Not the class lecturer or admin' })
  @ApiResponse({
    status: 404,
    description: 'Source or target group not found',
  })
  async reassignMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: ReassignMembersDto,
  ) {
    return this.groupsService.reassignMembers(
      id,
      dto,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Update member role (leader or admin)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiParam({ name: 'userId', description: 'Member user UUID' })
  @ApiResponse({ status: 200, type: [GroupMemberEntity] })
  @ApiResponse({
    status: 403,
    description: 'Only group leaders can update roles',
  })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.groupsService.updateMember(
      id,
      userId,
      dto,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from the group (leader or admin)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiParam({ name: 'userId', description: 'Member user UUID' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 400, description: 'Cannot remove the last leader' })
  @ApiResponse({
    status: 403,
    description: 'Only group leaders can remove members',
  })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.removeMember(
      id,
      userId,
      req.user.id,
      req.user.role as Role,
    );
  }

  // ── Repository management ──────────────────────────────

  @Get(':id/repos')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List all repositories linked to a group' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  async getGroupRepos(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.getGroupRepos(id);
  }

  @Post(':id/repos')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Link a repository to a group (leader only)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  async addGroupRepo(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() body: { repo_url: string; repo_name: string; repo_owner: string },
  ) {
    return this.groupsService.addGroupRepo(
      id,
      req.user.id,
      req.user.role as Role,
      body,
    );
  }

  @Delete(':id/repos/:repoId')
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a repository from a group (leader only)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiParam({ name: 'repoId', description: 'GroupRepository UUID' })
  async removeGroupRepo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repoId', ParseUUIDPipe) repoId: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.groupsService.removeGroupRepo(
      id,
      repoId,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get(':id/repos/:repoId/commits')
  @ApiExcludeEndpoint()
  @Roles(Role.LECTURER, Role.STUDENT)
  @ApiOperation({ summary: 'Get recent commits for a linked group repository' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiParam({ name: 'repoId', description: 'GroupRepository ID' })
  @ApiResponse({
    status: 200,
    description: 'List of recent commits',
  })
  async getGroupRepoCommits(
    @Param('id') groupId: string,
    @Param('repoId') repoId: string,
  ) {
    return this.groupsService.getGroupRepoCommits(groupId, repoId);
  }
}
