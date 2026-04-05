import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ChatMessageType } from '../../../common/enums';

export class SendChatMessageDto {
  @ApiProperty({ example: 'Hello teacher, I need feedback for milestone 2.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ enum: ChatMessageType, example: ChatMessageType.TEXT })
  @IsOptional()
  @IsEnum(ChatMessageType)
  type?: ChatMessageType = ChatMessageType.TEXT;

  @ApiPropertyOptional({
    example: 'mobile-msg-001',
    description: 'Client-generated idempotency key, unique per conversation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  client_id?: string;
}
