import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SemesterStatus } from '../../../common/enums';

export class CreateSemesterDto {
  @ApiProperty({ example: 'SP26' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 'Spring 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '2026-01-10' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ example: '2026-05-10' })
  @IsDateString()
  end_date: string;

  @ApiPropertyOptional({ enum: SemesterStatus, example: SemesterStatus.UPCOMING })
  @IsEnum(SemesterStatus)
  status?: SemesterStatus;
}

