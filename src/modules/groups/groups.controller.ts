import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { QueryGroupsDto } from './dto/query-groups.dto';
import {
  GroupDetailEntity,
  GroupMemberEntity,
  PaginatedGroupsEntity,
} from './entities/group.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // ── Group CRUD ─────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new group (caller becomes leader)' })
  @ApiResponse({ status: 201, type: GroupDetailEntity })
  async create(@Req() req: any, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List groups (students see own, lecturers/admins see all)',
  })
  @ApiResponse({ status: 200, type: PaginatedGroupsEntity })
  async findAll(@Req() req: any, @Query() query: QueryGroupsDto) {
    return this.groupsService.findAll(req.user.id, req.user.role, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group details with members' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: GroupDetailEntity })
  @ApiResponse({ status: 403, description: 'Not a member of this group' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.groupsService.findOne(id, req.user.id, req.user.role);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update group info (leader or admin only)' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, type: GroupDetailEntity })
  @ApiResponse({ status: 403, description: 'Only group leaders can update' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, req.user.id, req.user.role, dto);
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
    @Req() req: any,
    @Body() dto: AddMemberDto,
  ) {
    return this.groupsService.addMember(id, dto, req.user.id, req.user.role);
  }

  // Static "/me" route must come before parametric "/:userId" routes
  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Leave a group voluntarily' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 204, description: 'Left the group' })
  @ApiResponse({ status: 400, description: 'Cannot leave as last leader' })
  @ApiResponse({ status: 404, description: 'Not a member of this group' })
  async leaveGroup(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
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
    @Req() req: any,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.groupsService.updateMember(
      id,
      userId,
      dto,
      req.user.id,
      req.user.role,
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
    @Req() req: any,
  ) {
    return this.groupsService.removeMember(
      id,
      userId,
      req.user.id,
      req.user.role,
    );
  }
}
