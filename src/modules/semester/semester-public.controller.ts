import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SemesterService } from './semester.service';

@ApiTags('Semester')
@Controller('semesters')
export class SemesterPublicController {
  constructor(private readonly semesterService: SemesterService) {}

  @Get()
  @ApiOperation({ summary: 'List semesters for all roles' })
  async listSemesters() {
    return this.semesterService.listPublicSemesters();
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current semester for all roles' })
  async getCurrentSemester() {
    return this.semesterService.getCurrentSemester();
  }
}
