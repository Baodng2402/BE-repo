import {
  BadRequestException,
  Body,
  Controller,
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
import { CreateSemesterDto } from './dto/create-semester.dto';
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

  @Post(':id/import')
  @ApiOperation({ summary: 'Validate or import lecturer + student Excel/XLSX' })
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
          cb(new BadRequestException('Only Excel/XLSX files are allowed.'), false);
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

