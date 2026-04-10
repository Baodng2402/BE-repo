import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SrsVersionStatus } from '../../../common/enums';

export class ReviewSrsVersionDto {
  @ApiProperty({
    enum: [SrsVersionStatus.APPROVED, SrsVersionStatus.CHANGES_REQUESTED],
    example: SrsVersionStatus.APPROVED,
  })
  @IsEnum(SrsVersionStatus, {
    message: 'status must be APPROVED or CHANGES_REQUESTED',
  })
  status: SrsVersionStatus.APPROVED | SrsVersionStatus.CHANGES_REQUESTED;

  @ApiProperty({
    example: 'Great work on the requirements section',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  feedback?: string;
}
