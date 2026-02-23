import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { GroupStatus } from '@prisma/client';

export class QueryGroupsDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (1-based)',
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'HK2-2025',
    description: 'Filter by semester',
  })
  @IsString()
  @IsOptional()
  semester?: string;

  @ApiPropertyOptional({
    enum: GroupStatus,
    example: 'ACTIVE',
    description: 'Filter by status',
  })
  @IsEnum(GroupStatus)
  @IsOptional()
  status?: GroupStatus;

  @ApiPropertyOptional({ example: 'Alpha', description: 'Search by name' })
  @IsString()
  @IsOptional()
  search?: string;
}
