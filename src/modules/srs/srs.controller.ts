import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Role } from '../../common/enums';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SrsService } from './srs.service';
import { UpdateSrsDraftDto } from './dto/update-srs-draft.dto';
import { ReviewSrsVersionDto } from './dto/review-srs-version.dto';

@ApiTags('SRS')
@Controller('srs')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SrsController {
  constructor(private readonly srsService: SrsService) {}

  @Post('group/:groupId/generate')
  @Roles(Role.STUDENT, Role.GROUP_LEADER, Role.LECTURER)
  @ApiOperation({ summary: 'Generate SRS via AI and save as draft' })
  async generateDraft(
    @Req() req: AuthorizedRequest,
    @Param('groupId') groupId: string,
  ) {
    return this.srsService.generateAndSaveDraft(groupId, req.user.id);
  }

  @Get('group/:groupId')
  @ApiOperation({ summary: 'Get SRS document with all versions' })
  async getDocument(@Param('groupId') groupId: string) {
    return this.srsService.getDocument(groupId);
  }

  @Put('group/:groupId/draft')
  @Roles(Role.STUDENT, Role.GROUP_LEADER)
  @ApiOperation({ summary: 'Update SRS draft content' })
  async updateDraft(
    @Req() req: AuthorizedRequest,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateSrsDraftDto,
  ) {
    return this.srsService.updateDraft(groupId, req.user.id, dto);
  }

  @Post('group/:groupId/versions')
  @Roles(Role.STUDENT, Role.GROUP_LEADER)
  @ApiOperation({
    summary: 'Create a new version from current draft (Leader only)',
  })
  async createVersion(
    @Req() req: AuthorizedRequest,
    @Param('groupId') groupId: string,
  ) {
    return this.srsService.createVersion(groupId, req.user.id);
  }

  @Post('group/:groupId/versions/:versionId/submit')
  @Roles(Role.STUDENT, Role.GROUP_LEADER)
  @ApiOperation({
    summary: 'Submit a version for lecturer review (Leader only)',
  })
  async submitVersion(
    @Req() req: AuthorizedRequest,
    @Param('groupId') groupId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.srsService.submitVersion(groupId, versionId, req.user.id);
  }

  @Get('group/:groupId/versions/:versionId')
  @ApiOperation({ summary: 'Get a specific SRS version' })
  async getVersion(
    @Param('groupId') groupId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.srsService.getVersion(groupId, versionId);
  }

  @Patch('versions/:versionId/review')
  @Roles(Role.LECTURER)
  @ApiOperation({ summary: 'Review a submitted SRS version (Lecturer only)' })
  async reviewVersion(
    @Req() req: AuthorizedRequest,
    @Param('versionId') versionId: string,
    @Body() dto: ReviewSrsVersionDto,
  ) {
    return this.srsService.reviewVersion(versionId, req.user.id, dto);
  }

  @Get('lecturer/submissions')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({ summary: 'List all pending SRS submissions for review' })
  @ApiQuery({ name: 'classId', required: false })
  async getLecturerSubmissions(@Query('classId') classId?: string) {
    return this.srsService.getLecturerSubmissions(classId);
  }
}
