import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSemesterLecturerDto {
  @ApiProperty({ example: 'lecturer.swp391@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Nguyen Van Lecturer' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiPropertyOptional({ example: 'strongPassword123' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
