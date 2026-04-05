import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChatConversationStatus,
  ChatMessageType,
  Role,
} from '../../../common/enums';

export class ChatMessageEntity {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'conv-uuid' })
  conversation_id: string;

  @ApiProperty({ example: 'sender-uuid' })
  sender_id: string;

  @ApiProperty({ example: 'Hello teacher, I need feedback for milestone 2.' })
  content: string;

  @ApiProperty({ enum: ChatMessageType, example: ChatMessageType.TEXT })
  type: ChatMessageType;

  @ApiPropertyOptional({ example: 'mobile-msg-001', nullable: true })
  client_id?: string | null;

  @ApiPropertyOptional({ example: '2026-03-27T14:10:00.000Z', nullable: true })
  read_by_recipient_at?: Date | null;

  @ApiProperty({ example: '2026-03-27T14:00:00.000Z' })
  created_at: Date;

  @ApiProperty({ example: '2026-03-27T14:00:00.000Z' })
  updated_at: Date;
}

export class ChatParticipantEntity {
  @ApiProperty({ example: 'user-uuid' })
  id: string;

  @ApiProperty({ example: 'lecturer@fpt.edu.vn' })
  email: string;

  @ApiPropertyOptional({ example: 'Nguyen Van A', nullable: true })
  full_name?: string | null;

  @ApiProperty({ enum: Role, example: Role.LECTURER })
  role: Role;
}

export class ChatConversationEntity {
  @ApiProperty({ example: 'conv-uuid' })
  id: string;

  @ApiProperty({ example: 'semester-uuid' })
  semester_id: string;

  @ApiProperty({ example: 'class-uuid' })
  class_id: string;

  @ApiProperty({ example: 'student-uuid' })
  student_id: string;

  @ApiProperty({ example: 'lecturer-uuid' })
  lecturer_id: string;

  @ApiProperty({
    enum: ChatConversationStatus,
    example: ChatConversationStatus.ACTIVE,
  })
  status: ChatConversationStatus;

  @ApiPropertyOptional({ example: 'Hello teacher...', nullable: true })
  last_message_preview?: string | null;

  @ApiPropertyOptional({ example: '2026-03-27T14:00:00.000Z', nullable: true })
  last_message_at?: Date | null;

  @ApiProperty({ example: 3 })
  unread_count: number;

  @ApiPropertyOptional({ type: ChatMessageEntity, nullable: true })
  last_message?: ChatMessageEntity | null;

  @ApiProperty({ type: ChatParticipantEntity })
  counterpart: ChatParticipantEntity;

  @ApiProperty({ example: 'SEP490_G1' })
  class_code: string;

  @ApiProperty({ example: 'Spring 2026' })
  semester_name: string;

  @ApiProperty({ example: '2026-03-27T14:00:00.000Z' })
  created_at: Date;

  @ApiProperty({ example: '2026-03-27T14:00:00.000Z' })
  updated_at: Date;
}

export class ChatConversationListEntity {
  @ApiProperty({ type: [ChatConversationEntity] })
  data: ChatConversationEntity[];
}

export class ChatMessageListEntity {
  @ApiProperty({ type: [ChatMessageEntity] })
  data: ChatMessageEntity[];

  @ApiProperty({
    example: {
      next_cursor: '2026-03-27T13:50:00.000Z',
      limit: 20,
      has_more: true,
    },
  })
  meta: {
    next_cursor: string | null;
    limit: number;
    has_more: boolean;
  };
}

export class ChatReadReceiptEntity {
  @ApiProperty({ example: 'conv-uuid' })
  conversation_id: string;

  @ApiProperty({ example: 4 })
  read_count: number;

  @ApiProperty({ example: '2026-03-27T14:12:00.000Z' })
  read_at: Date;
}
