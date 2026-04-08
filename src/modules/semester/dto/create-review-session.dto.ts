import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ReviewMilestoneCode,
  ReviewProblemStatus,
  ReviewSessionStatus,
} from '../../../common/enums';

export class ReviewSessionProblemDto {
  @ApiPropertyOptional({ example: 'problem-api-timeout' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;
  @ApiProperty({ example: 'API timeout blocks issue sync' })
  @IsString()
  @MaxLength(255)
  title: string;
  @ApiProperty({ enum: ReviewProblemStatus })
  @IsEnum(ReviewProblemStatus)
  status: ReviewProblemStatus;
  @ApiPropertyOptional({
    example: 'Still blocked by missing Jira permission. Required while status is not-done.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReviewSessionAttendanceRecordDto {
  @ApiProperty({ example: 'student-1' })
  @IsString()
  user_id: string;

  @ApiPropertyOptional({ example: 'Nguyen Van A' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  user_name?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  present: boolean;
}

export class CreateReviewSessionDto {
  @ApiProperty({ enum: ReviewMilestoneCode })
  @IsEnum(ReviewMilestoneCode)
  milestone_code: ReviewMilestoneCode;

  @ApiProperty({ example: '2026-03-12T09:00:00.000Z' })
  @IsDateString()
  review_date: string;

  @ApiProperty({ example: 'Review 1 progress review' })
  @IsString()
  @MaxLength(160)
  title: string;

  @ApiPropertyOptional({ enum: ReviewSessionStatus })
  @IsOptional()
  @IsEnum(ReviewSessionStatus)
  status?: ReviewSessionStatus;

  @ApiPropertyOptional({
    example: 'Weekly review with task ownership and blocker check.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  lecturer_note?: string;

  @ApiPropertyOptional({
    example: 'Completed Jira integration hardening and task reassignment fixes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  what_done_since_last_review?: string;

  @ApiPropertyOptional({
    example: 'Prepare final API demo and regression checklist before checkpoint.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  next_plan_until_next_review?: string;

  @ApiPropertyOptional({
    example: 'Previous permission issue was fixed, but deployment quota is still unstable.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  previous_problem_followup?: string;

  @ApiPropertyOptional({
    type: [ReviewSessionProblemDto],
    example: [
      {
        id: 'problem-api-timeout',
        title: 'API timeout blocks issue sync',
        status: 'not-done',
        note: 'Need infra support before the next checkpoint.',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewSessionProblemDto)
  current_problems?: ReviewSessionProblemDto[];

  @ApiPropertyOptional({
    example: 0.8,
    description: 'Attendance ratio for the whole group, between 0 and 1.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  attendance_ratio?: number;

  @ApiPropertyOptional({
    type: [ReviewSessionAttendanceRecordDto],
    example: [
      { user_id: 'student-1', user_name: 'Nguyen Van A', present: true },
      { user_id: 'student-2', user_name: 'Tran Thi B', present: false },
    ],
    description:
      'Per-student attendance for this review session. Used to derive attendance_ratio when provided.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewSessionAttendanceRecordDto)
  attendance_records?: ReviewSessionAttendanceRecordDto[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object' },
    default: [],
    description:
      'Legacy member-level participant reports. Kept optional for compatibility but not required by the new group-based review flow.',
  })
  @IsOptional()
  @IsArray()
  participant_reports?: Array<Record<string, unknown>>;
}
