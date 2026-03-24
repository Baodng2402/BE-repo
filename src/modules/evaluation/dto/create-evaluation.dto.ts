import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContributionItemDto } from './contribution-item.dto';

export class CreateEvaluationDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Group ID',
  })
  @IsUUID()
  @IsNotEmpty()
  group_id: string;

  @ApiProperty({
    example: 'Sprint 3 Evaluation',
    description: 'Evaluation title',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    example: 'End of sprint contribution split',
    description: 'Optional description or notes',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    type: [ContributionItemDto],
    description:
      'Contribution percentages for all active group members (must sum to 100%)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContributionItemDto)
  contributions: ContributionItemDto[];
}
