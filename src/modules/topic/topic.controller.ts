import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateAiTopicDto } from './dto/create-ai-topic.dto';
import { GenerateTopicIdeaDto } from './dto/generate-topic-idea.dto';
import { TopicService } from './topic.service';

@ApiTags('Topics')
@Controller('topics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class TopicController {
  constructor(private readonly topicService: TopicService) {}

  @Get()
  @ApiOperation({ summary: 'Get all available project topics' })
  async getAllTopics(@Query('includeTaken') includeTaken?: string) {
    const includeTakenFlag = includeTaken !== 'false';
    return this.topicService.getAllTopics(includeTakenFlag);
  }

  @Get('available')
  @ApiOperation({ summary: 'Get all topics that are not taken' })
  async getAvailableTopics() {
    return this.topicService.getAllTopics(false);
  }

  @Post('ai/generate')
  @ApiOperation({
    summary: 'Generate or refine a topic idea with AI and full context fields',
  })
  async generateTopicIdea(@Body() dto: GenerateTopicIdeaDto) {
    return this.topicService.generateTopicIdea(dto);
  }

  @Post('ai/create')
  @ApiOperation({
    summary: 'Create a new topic from AI-generated draft after user review',
  })
  async createTopicFromAi(@Body() dto: CreateAiTopicDto) {
    return this.topicService.createTopicFromAi(dto);
  }
}
