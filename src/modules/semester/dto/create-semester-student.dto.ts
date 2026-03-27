import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateSemesterStudentDto {
  @ApiProperty({ example: 'student.swp391@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SE180001' })
  @IsString()
  @IsNotEmpty()
  student_id: string;

  @ApiProperty({ example: 'Nguyen Van Student' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  @IsUUID()
  class_id: string;

  @ApiPropertyOptional({ example: 'studentPassword123' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
