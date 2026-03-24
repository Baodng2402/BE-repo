import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ContributionItemDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID of the group member',
  })
  @IsUUID()
  @IsNotEmpty()
  user_id: string;

  @ApiProperty({
    example: 16.67,
    description: 'Contribution percentage (0.00–100.00)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  contribution_percent: number;

  @ApiPropertyOptional({
    example: 'Led the backend implementation',
    description: 'Optional note about this member contribution',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
