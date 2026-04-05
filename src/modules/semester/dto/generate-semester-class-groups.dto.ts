import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GenerateSemesterClassGroupsDto {
  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    maximum: 20,
    description:
      'Optional target total number of groups for the class. Defaults to class.max_groups.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  group_count?: number;
}
