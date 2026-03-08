import { ApiProperty } from '@nestjs/swagger';

export class ImportFailedRow {
  @ApiProperty({ example: 3 })
  row: number;

  @ApiProperty({ example: 'bad-email' })
  email: string;

  @ApiProperty({ example: 'Invalid email format' })
  reason: string;
}

export class ImportStudentsResponseDto {
  @ApiProperty({ example: 30 })
  total: number;

  @ApiProperty({ example: 25 })
  enrolled: number;

  @ApiProperty({ example: 15, description: 'New accounts created' })
  created: number;

  @ApiProperty({ example: 5 })
  already_enrolled: number;

  @ApiProperty({
    example: ['Only 12 students imported — expected at least 15'],
    type: [String],
  })
  warnings: string[];

  @ApiProperty({ type: [ImportFailedRow] })
  failed: ImportFailedRow[];
}
