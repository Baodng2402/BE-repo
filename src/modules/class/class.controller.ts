import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import type { AuthorizedRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassService } from './class.service';
import { CreateClassDto } from './dto/create-class.dto';
import { ImportStudentsResponseDto } from './dto/import-students-response.dto';
import { JoinClassDto } from './dto/join-class.dto';
import { parseStudentFile } from './utils/file-parser.util';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new class (Lecturer only)' })
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
  @ApiOperation({ summary: 'Get all classes' })
  async getClasses(@Req() req: AuthorizedRequest) {
    return this.classService.getAllClasses(req.user.id, req.user.role);
  }

  @Get('my-classes')
  @ApiOperation({ summary: 'Get classes enrolled by the current user' })
  async getMyClasses(@Req() req: AuthorizedRequest) {
    return this.classService.myClasses(req.user.id);
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
    @Param('id') classId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const rows = await parseStudentFile(file.buffer, file.mimetype);
    return this.classService.importStudents(classId, rows);
  }
}
