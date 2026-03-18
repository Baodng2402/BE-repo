import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateAiTopicDto {
  @ApiProperty({ example: 'Smart Internship Matching Assistant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  topic_name: string;

  @ApiProperty({
    example:
      'Universities and students need a better way to align internships with skills and project goals.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1200)
  context: string;

  @ApiProperty({
    example:
      'Current matching is manual and often leads to low-fit placements and weak project outcomes.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1200)
  problem_statement: string;

  @ApiProperty({ example: 'Student, Team Leader, Lecturer, Company Mentor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  primary_actors: string;

  @ApiProperty({
    example:
      'Focuses on educational context and combines portfolio evidence with mentor preference constraints.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1200)
  uniqueness_rationale: string;
}
