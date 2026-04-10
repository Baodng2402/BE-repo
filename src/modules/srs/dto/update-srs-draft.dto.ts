import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateSrsDraftDto {
  @ApiProperty({ example: '# SRS Document\n\n## 1. Introduction\n...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content: string;
}
