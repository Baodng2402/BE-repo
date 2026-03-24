import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SetCurrentWeekDto } from './dto/set-current-week.dto';
import { SemesterService } from './semester.service';

@ApiTags('Semester Governance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('semesters')
export class SemesterGovernanceController {
  constructor(private readonly semesterService: SemesterService) {}

  @Get('current-week')
  @ApiOperation({
    summary: 'Get current semester week context for Lecturer/Admin/Student views',
  })
  async getCurrentWeek() {
    return this.semesterService.getCurrentWeek();
  }

  @Patch(':id/current-week')
  @ApiExcludeEndpoint()
  async setCurrentWeek(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: SetCurrentWeekDto,
  ) {
    return this.semesterService.setCurrentWeek(
      id,
      dto.current_week,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get('current/compliance/lecturer-summary')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Get lecturer/admin weekly compliance summary for the current semester',
  })
  async getLecturerComplianceSummary(
    @Req() req: AuthorizedRequest,
    @Query('classId') classId?: string,
  ) {
    return this.semesterService.getLecturerComplianceSummary(
      req.user.id,
      req.user.role as Role,
      classId,
    );
  }

  @Get('current/compliance/student-warning')
  @Roles(Role.STUDENT, Role.GROUP_LEADER)
  @ApiOperation({
    summary:
      'Get week-based warning payload for the current student/group leader',
  })
  async getStudentWarnings(@Req() req: AuthorizedRequest) {
    return this.semesterService.getStudentWeeklyWarnings(req.user.id);
  }
}
