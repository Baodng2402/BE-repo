import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum TopicGenerationMode {
  AUTO = 'AUTO',
  REFINE = 'REFINE',
}

export class GenerateTopicIdeaDto {
  @ApiProperty({
    enum: TopicGenerationMode,
    description:
      'AUTO = AI proposes topic name, REFINE = AI improves seed name',
  })
  @IsEnum(TopicGenerationMode)
  mode: TopicGenerationMode;

  @ApiPropertyOptional({
    description:
      'Seed topic name entered by student/team leader when mode=REFINE',
    example: 'AI-based attendance monitoring',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  seed_name?: string;

  @ApiPropertyOptional({
    description: 'Optional product/domain context',
    example: 'Education technology',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  project_domain?: string;

  @ApiPropertyOptional({
    description: 'Team context and constraints',
    example: '5 members, 12 weeks, web-first deliverable',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  team_context?: string;

  @ApiPropertyOptional({
    description: 'Known problem space to solve',
    example: 'Students miss deadlines because tasks are fragmented',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  problem_space?: string;

  @ApiPropertyOptional({
    description: 'Hint for primary actors',
    example: 'Student, Team Leader, Lecturer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  primary_actors_hint?: string;
}
