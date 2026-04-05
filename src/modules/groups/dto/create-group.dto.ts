import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Class UUID that the group belongs to',
  })
  @IsUUID('4', { message: 'class_id must be a valid UUID' })
  class_id: string;

  @ApiProperty({ example: 'Group Alpha', description: 'Group name' })
  @IsString()
  @IsNotEmpty({ message: 'Group name is required' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: 'E-Commerce Platform',
    description: 'Project name',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  project_name?: string;

  @ApiPropertyOptional({
    example: 'Building a full-stack e-commerce platform',
    description: 'Group description',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'HK2-2025', description: 'Semester code' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  semester?: string;

  @ApiPropertyOptional({
    example: 'https://github.com/org/repo',
    description: 'GitHub repository URL',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  github_repo_url?: string;

  @ApiPropertyOptional({
    example: 'ECOM',
    description: 'Jira project key',
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  jira_project_key?: string;
}
