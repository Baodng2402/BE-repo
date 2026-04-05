import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BulkExaminerAssignmentDto } from './dto/bulk-examiner-assignment.dto';
import { BulkTeachingAssignmentDto } from './dto/bulk-teaching-assignment.dto';
import { CreateSemesterClassDto } from './dto/create-semester-class.dto';
import { CreateSemesterLecturerDto } from './dto/create-semester-lecturer.dto';
import { CreateSemesterStudentDto } from './dto/create-semester-student.dto';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { GenerateSemesterClassGroupsDto } from './dto/generate-semester-class-groups.dto';
import { UpdateSemesterClassDto } from './dto/update-semester-class.dto';
import { UpdateSemesterLecturerDto } from './dto/update-semester-lecturer.dto';
import { UpdateSemesterStudentDto } from './dto/update-semester-student.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import { SemesterService } from './semester.service';
import { parseSemesterImportFile } from './utils/semester-import.util';

@ApiTags('Admin Semester')
@Controller('admin/semesters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class SemesterController {
  constructor(private readonly semesterService: SemesterService) {}

  @Get()
  @ApiOperation({ summary: 'List semesters for admin' })
  async listSemesters() {
    return this.semesterService.listSemesters();
  }

  @Post()
  @ApiOperation({ summary: 'Create a semester' })
  async createSemester(@Body() dto: CreateSemesterDto) {
    return this.semesterService.createSemester(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update semester metadata/status' })
  async updateSemester(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSemesterDto,
  ) {
    return this.semesterService.updateSemester(id, dto);
  }

  @Get(':id/import-batches')
  @ApiOperation({ summary: 'Get recent import batches for a semester' })
  async getImportBatches(@Param('id', ParseUUIDPipe) id: string) {
    return this.semesterService.getImportBatches(id);
  }

  @Get(':id/roster')
  @ApiOperation({
    summary: 'Get lecturer, student, and class roster for a semester',
  })
  async getSemesterRoster(@Param('id', ParseUUIDPipe) id: string) {
    return this.semesterService.getSemesterRoster(id);
  }

  @Get(':id/classes')
  @ApiOperation({ summary: 'List classes managed under a semester' })
  async listSemesterClasses(@Param('id', ParseUUIDPipe) id: string) {
    return this.semesterService.listSemesterClasses(id);
  }

  @Post(':id/classes')
  @ApiOperation({ summary: 'Create a class within a semester' })
  async createSemesterClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSemesterClassDto,
  ) {
    return this.semesterService.createSemesterClass(id, dto);
  }

  @Patch(':id/classes/:classId')
  @ApiOperation({ summary: 'Update code/name metadata for a semester class' })
  async updateSemesterClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: UpdateSemesterClassDto,
  ) {
    return this.semesterService.updateSemesterClass(id, classId, dto);
  }

  @Delete(':id/classes/:classId')
  @ApiOperation({ summary: 'Delete a class from a semester when safe' })
  async deleteSemesterClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    return this.semesterService.deleteSemesterClass(id, classId);
  }

  @Post(':id/classes/:classId/generate-groups')
  @ApiOperation({ summary: 'Generate default groups for a semester class' })
  async generateSemesterClassGroups(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: GenerateSemesterClassGroupsDto,
  ) {
    return this.semesterService.generateSemesterClassGroups(
      id,
      classId,
      req.user.id,
      dto.group_count,
    );
  }

  @Post(':id/roster/lecturers')
  @ApiOperation({
    summary: 'Create lecturer account for semester roster management',
  })
  async createSemesterLecturer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSemesterLecturerDto,
  ) {
    return this.semesterService.createSemesterLecturer(id, dto);
  }

  @Patch(':id/roster/lecturers/:userId')
  @ApiOperation({ summary: 'Update lecturer account used in semester roster' })
  async updateSemesterLecturer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateSemesterLecturerDto,
  ) {
    return this.semesterService.updateSemesterLecturer(id, userId, dto);
  }

  @Patch(':id/roster/students/:userId')
  @ApiOperation({
    summary:
      'Update student account or move class membership within a semester',
  })
  async updateSemesterStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateSemesterStudentDto,
  ) {
    return this.semesterService.updateSemesterStudent(id, userId, dto);
  }

  @Post(':id/roster/students')
  @ApiOperation({
    summary: 'Create student account and enroll into a semester class',
  })
  async createSemesterStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSemesterStudentDto,
  ) {
    return this.semesterService.createSemesterStudent(id, dto);
  }

  @Patch(':id/teaching-assignments')
  @ApiOperation({ summary: 'Bulk reassign lecturers to semester classes' })
  async bulkReassignTeachingAssignments(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: BulkTeachingAssignmentDto,
  ) {
    return this.semesterService.bulkReassignTeachingAssignments(
      id,
      req.user.id,
      dto,
    );
  }

  @Get(':id/examiner-assignments')
  @ApiOperation({ summary: 'Get examiner assignment board for a semester' })
  async getExaminerAssignments(@Param('id', ParseUUIDPipe) id: string) {
    return this.semesterService.getExaminerAssignments(id);
  }

  @Patch(':id/examiner-assignments')
  @ApiOperation({
    summary: 'Replace examiner assignments for semester classes',
  })
  async bulkAssignExaminers(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: BulkExaminerAssignmentDto,
  ) {
    return this.semesterService.bulkAssignExaminers(id, req.user.id, dto);
  }

  @Delete(':id/roster/lecturers/:userId')
  @ApiOperation({ summary: 'Delete lecturer account if it is safe to remove' })
  async deleteSemesterLecturer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.semesterService.deleteSemesterLecturer(id, userId);
  }

  @Delete(':id/roster/students/:userId')
  @ApiOperation({ summary: 'Remove student from semester roster' })
  async deleteSemesterStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.semesterService.deleteSemesterStudent(id, userId);
  }

  @Post(':id/import')
  @ApiOperation({ summary: 'Validate or import student roster Excel/XLSX' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('Only Excel/XLSX files are allowed.'),
            false,
          );
        }
      },
    }),
  )
  async importSemesterData(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
    },
    @Query('mode') mode: 'validate' | 'import' = 'validate',
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('File is required.');
    }

    const rows = await parseSemesterImportFile(file.buffer, file.mimetype);
    return this.semesterService.processImport(
      id,
      req.user.id,
      file.originalname || 'semester-import.xlsx',
      rows,
      mode === 'import' ? 'IMPORT' : 'VALIDATE',
    );
  }
}
