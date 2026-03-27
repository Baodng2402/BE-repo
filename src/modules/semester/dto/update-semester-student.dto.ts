import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateSemesterStudentDto } from './create-semester-student.dto';

export class UpdateSemesterStudentDto extends PartialType(
  CreateSemesterStudentDto,
) {
  @ApiPropertyOptional({ example: '11111111-1111-1111-1111-111111111111' })
  @IsOptional()
  @IsUUID()
  class_id?: string;
}
