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
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import {
  GroupDetailEntity,
  GroupMemberEntity,
  PaginatedGroupsEntity,
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
  @ApiOperation({ summary: 'Create a new group (caller becomes leader)' })
  @ApiResponse({ status: 201, type: GroupDetailEntity })
  async create(@Req() req: AuthorizedRequest, @Body() dto: CreateGroupDto) {
    return await this.groupsService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List groups (students see own, lecturers/admins see all)',
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
  @ApiOperation({ summary: 'Get all groups for a specific class' })
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

  @Post(':id/join')
  @ApiOperation({
    summary: 'Join an empty group (first to join becomes LEADER)',
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
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) {
    return this.groupsService.findOne(id, req.user.id, req.user.role as Role);
  }

  @Get(':id/integration-status')
  @ApiOperation({
    summary: 'Get integration readiness for the current user and group',
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update group info (leader or admin only)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: GroupDetailEntity })
  @ApiResponse({ status: 403, description: 'Only group leaders can update' })
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
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group (admin only)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 204, description: 'Group deleted' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.remove(id);
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
  async leaveGroup(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) {
    return this.groupsService.leaveGroup(id, req.user.id);
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
  @ApiOperation({ summary: 'List all repositories linked to a group' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  async getGroupRepos(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.getGroupRepos(id);
  }

  @Post(':id/repos')
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
