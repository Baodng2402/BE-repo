import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClassCheckpointService } from './class-checkpoint.service';
import { UpsertClassCheckpointsDto } from './dto/upsert-class-checkpoints.dto';

@ApiTags('Class Checkpoints')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClassCheckpointController {
  constructor(private readonly checkpointService: ClassCheckpointService) {}

  @Get(':classId/checkpoints')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Get checkpoint configurations for a class in the current semester (auto-seeds defaults if none exist)',
  })
  @ApiResponse({ status: 200, description: 'Checkpoint configs returned' })
  @ApiResponse({ status: 404, description: 'Class or semester not found' })
  async getCheckpoints(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.checkpointService.getCheckpoints(
      classId,
      req.user.id,
      req.user.role,
    );
  }

  @Put(':classId/checkpoints')
  @Roles(Role.LECTURER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Bulk upsert all 3 checkpoint configs (deadline weeks + descriptions)',
  })
  @ApiResponse({ status: 200, description: 'Checkpoints saved' })
  @ApiResponse({
    status: 400,
    description: 'Validation error (weeks not ascending, published grades)',
  })
  async upsertCheckpoints(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Req() req: AuthorizedRequest,
    @Body() dto: UpsertClassCheckpointsDto,
  ) {
    return this.checkpointService.upsertCheckpoints(
      classId,
      req.user.id,
      req.user.role,
      dto,
    );
  }
}
