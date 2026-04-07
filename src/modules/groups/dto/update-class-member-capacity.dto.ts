import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateClassMemberCapacityDto {
  @ApiProperty({
    example: 6,
    description: 'New maximum students allowed per group in this class.',
  })
  @IsInt()
  @Min(1)
  @Max(50)
  max_students_per_group: number;
}
