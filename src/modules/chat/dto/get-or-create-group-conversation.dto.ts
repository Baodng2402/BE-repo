import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class GetOrCreateGroupConversationDto {
  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  @IsUUID('4')
  semester_id: string;

  @ApiProperty({ example: '22222222-2222-2222-2222-222222222222' })
  @IsUUID('4')
  class_id: string;

  @ApiProperty({ example: '33333333-3333-3333-3333-333333333333' })
  @IsUUID('4')
  group_id: string;

  @ApiPropertyOptional({ example: '44444444-4444-4444-4444-444444444444' })
  @IsOptional()
  @IsUUID('4')
  lecturer_id?: string;
}
