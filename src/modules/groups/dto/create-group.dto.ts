import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
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
