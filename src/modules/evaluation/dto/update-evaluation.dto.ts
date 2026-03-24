import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContributionItemDto } from './contribution-item.dto';

export class UpdateEvaluationDto {
  @ApiPropertyOptional({
    example: 'Sprint 3 Evaluation (revised)',
    description: 'Updated title',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated contribution split after review',
    description: 'Updated description',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    type: [ContributionItemDto],
    description:
      'Full replacement of contributions (all active members, must sum to 100%)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => ContributionItemDto)
  contributions?: ContributionItemDto[];
}
