import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class SetCurrentWeekDto {
  @ApiProperty({ example: 2, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  current_week: number;
}
