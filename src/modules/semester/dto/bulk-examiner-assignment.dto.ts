import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ExaminerAssignmentItemDto {
  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  @IsUUID()
  class_id: string;

  @ApiProperty({
    type: [String],
    example: ['22222222-2222-2222-2222-222222222222'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  lecturer_ids: string[];
}

export class BulkExaminerAssignmentDto {
  @ApiProperty({ type: [ExaminerAssignmentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExaminerAssignmentItemDto)
  assignments: ExaminerAssignmentItemDto[];
}
