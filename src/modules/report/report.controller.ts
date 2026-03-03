import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportService } from './report.service';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('srs/:groupId')
  @ApiOperation({
    summary: 'Generate Software Requirements Specification (SRS) via AI',
  })
  async generateSrs(
    @Req() req: AuthorizedRequest,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return await this.reportService.generateSrs(groupId, req.user.id);
  }

  @Get('assignments/:groupId')
  @ApiOperation({ summary: 'Generate Jira task assignment report' })
  async generateAssignmentReport(
    @Req() req: AuthorizedRequest,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return await this.reportService.generateAssignmentReport(
      groupId,
      req.user.id,
    );
  }

  @Get('commits/:groupId')
  @ApiOperation({ summary: 'Generate GitHub commit contribution report' })
  async generateCommitReport(
    @Req() req: AuthorizedRequest,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return await this.reportService.generateCommitReport(groupId, req.user.id);
  }
}
