import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClassService } from './class.service';
import { ClassAnalyticsResponseDto } from './dto/class-analytics.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { ImportStudentsResponseDto } from './dto/import-students-response.dto';
import { JoinClassDto } from './dto/join-class.dto';
import { parseStudentFile } from './utils/file-parser.util';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Post()
  @Roles(Role.LECTURER)
  @ApiOperation({
    summary:
      'Legacy endpoint disabled: class creation must be done by Admin inside semester management',
  })
  @ApiResponse({
    status: 201,
    description:
      'Class created alongside 7 empty groups and notifications sent',
  })
  async createClass(
    @Req() req: AuthorizedRequest,
    @Body() dto: CreateClassDto,
  ) {
    return this.classService.createClass(req.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all classes (discovery)',
  })
  async getClasses(@Req() req: AuthorizedRequest) {
    return this.classService.getAllClasses(req.user.id, req.user.role);
  }

  @Get('my-classes')
  @ApiOperation({
    summary: '[Step 0] Get classes for current user',
    description:
      'Lecturer gets assigned classes. Student gets enrolled classes. Use classId with GET /groups/class/:classId next.',
  })
  async getMyClasses(@Req() req: AuthorizedRequest) {
    return this.classService.myClasses(req.user.id, req.user.role as Role);
  }

  @Get(':id/analytics')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary: 'Get class overview analytics (Lecturer/Admin only)',
  })
  @ApiResponse({ status: 200, type: ClassAnalyticsResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to view this class',
  })
  @ApiResponse({ status: 404, description: 'Class not found' })
  async getClassAnalytics(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) classId: string,
  ) {
    return this.classService.getClassAnalytics(
      classId,
      req.user.id,
      req.user.role,
    );
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join a class using an enrollment key' })
  async joinClass(
    @Req() req: AuthorizedRequest,
    @Param('id') classId: string,
    @Body() dto: JoinClassDto,
  ) {
    return this.classService.joinClass(req.user.id, classId, dto);
  }

  @Post(':id/import-students')
  @Roles(Role.LECTURER)
  @ApiOperation({
    summary: 'Import students from CSV/XLSX file (Lecturer only)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: ImportStudentsResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 1024 * 1024 }, // 1 MB
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'text/csv',
          'application/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('Only CSV and XLSX files are allowed'),
            false,
          );
        }
      },
    }),
  )
  async importStudents(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) classId: string,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
    },
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException(
        'File is required and must contain content',
      );
    }

    const rows = await parseStudentFile(file.buffer, file.mimetype);
    return this.classService.importStudents(classId, rows);
  }
}
