import {
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../entities';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { EvaluationService } from './evaluation.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { UpdateEvaluationDto } from './dto/update-evaluation.dto';
import { QueryEvaluationsDto } from './dto/query-evaluations.dto';
import {
  EvaluationDetailEntity,
  MyContributionEntity,
} from './entities/evaluation-detail.entity';

@ApiTags('Evaluations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('evaluations')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post()
  @ApiOperation({
    summary: 'Create evaluation with contribution splits',
    description:
      'Create a new evaluation for a group. All active members must be included and percentages must sum to 100%.',
  })
  @ApiOkResponse({ type: EvaluationDetailEntity })
  async create(
    @Body() dto: CreateEvaluationDto,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.createEvaluation(
      dto,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List evaluations for a group',
    description:
      'Returns paginated list of evaluations. Members see their group; lecturers see any group.',
  })
  async findAll(
    @Query() dto: QueryEvaluationsDto,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.findAll(dto, req.user.id, req.user.role as Role);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get evaluation detail',
    description:
      'Returns evaluation with all contribution percentages and member info.',
  })
  @ApiOkResponse({ type: EvaluationDetailEntity })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.findOne(id, req.user.id, req.user.role as Role);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update evaluation',
    description:
      'Update title, description, or contribution splits. If contributions provided, must include all members and sum to 100%.',
  })
  @ApiOkResponse({ type: EvaluationDetailEntity })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEvaluationDto,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.update(id, dto, req.user.id, req.user.role as Role);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete evaluation',
    description:
      'Delete an evaluation and all its contributions. Leader or admin only.',
  })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.delete(id, req.user.id, req.user.role as Role);
  }

  @Get(':id/my-contribution')
  @ApiOperation({
    summary: 'Get my contribution percentage',
    description:
      "Returns the calling user's contribution percentage for a specific evaluation.",
  })
  @ApiOkResponse({ type: MyContributionEntity })
  async getMyContribution(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.evaluationService.getMyContribution(id, req.user.id);
  }
}
