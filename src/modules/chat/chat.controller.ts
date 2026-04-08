import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatSendRateLimitGuard } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { GetOrCreateConversationDto } from './dto/get-or-create-conversation.dto';
import { GetOrCreateGroupConversationDto } from './dto/get-or-create-group-conversation.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import {
  ChatConversationEntity,
  ChatConversationListEntity,
  ChatMessageEntity,
  ChatMessageListEntity,
  ChatReadReceiptEntity,
} from './entities/chat-response.entity';

@ApiTags('Chat')
@ApiBearerAuth()
@ApiExtraModels(
  ChatConversationEntity,
  ChatConversationListEntity,
  ChatMessageEntity,
  ChatMessageListEntity,
  ChatReadReceiptEntity,
)
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({
    summary:
      'Get or create a 1-1 chat conversation within semester/class context',
  })
  @ApiBody({
    type: GetOrCreateConversationDto,
    examples: {
      studentOpensConversation: {
        value: {
          semester_id: '11111111-1111-1111-1111-111111111111',
          class_id: '22222222-2222-2222-2222-222222222222',
          student_id: '33333333-3333-3333-3333-333333333333',
          lecturer_id: '44444444-4444-4444-4444-444444444444',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: ChatConversationEntity })
  async getOrCreateConversation(
    @Req() req: AuthorizedRequest,
    @Body() dto: GetOrCreateConversationDto,
  ) {
    return this.chatService.getOrCreateConversation(
      req.user.id,
      req.user.role as Role,
      dto,
    );
  }

  @Post('group-conversations')
  @ApiOperation({
    summary: 'Get or create a group-room chat conversation (1 room per group)',
  })
  @ApiBody({
    type: GetOrCreateGroupConversationDto,
    examples: {
      lecturerOpensGroupRoom: {
        value: {
          semester_id: '11111111-1111-1111-1111-111111111111',
          class_id: '22222222-2222-2222-2222-222222222222',
          group_id: '33333333-3333-3333-3333-333333333333',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: ChatConversationEntity })
  async getOrCreateGroupConversation(
    @Req() req: AuthorizedRequest,
    @Body() dto: GetOrCreateGroupConversationDto,
  ) {
    return this.chatService.getOrCreateGroupConversation(
      req.user.id,
      req.user.role as Role,
      dto,
    );
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List chat conversations for the current user' })
  @ApiResponse({ status: 200, type: ChatConversationListEntity })
  async listConversations(@Req() req: AuthorizedRequest) {
    return this.chatService.listConversations(req.user.id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary:
      'List chat messages with cursor pagination ordered by created_at DESC',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    example: '2026-03-27T14:00:00.000Z',
  })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, type: ChatMessageListEntity })
  async listMessages(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryChatMessagesDto,
  ) {
    return this.chatService.listMessages(req.user.id, id, query);
  }

  @Post('conversations/:id/messages')
  @UseGuards(ChatSendRateLimitGuard)
  @ApiOperation({ summary: 'Send a message into a conversation you belong to' })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiBody({
    type: SendChatMessageDto,
    examples: {
      sendText: {
        value: {
          content: 'Hello teacher, I have updated the milestone review doc.',
          type: 'TEXT',
          client_id: 'mobile-msg-001',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: ChatMessageEntity })
  async sendMessage(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.chatService.createMessage(req.user.id, id, dto);
  }

  @Patch('conversations/:id/read')
  @ApiOperation({
    summary: 'Mark all unread messages in the conversation as read',
  })
  @ApiResponse({ status: 200, type: ChatReadReceiptEntity })
  async markConversationRead(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.markConversationRead(req.user.id, id);
  }

  @Patch('messages/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Backward-compatible read endpoint that marks up to a message as read',
  })
  @ApiResponse({ status: 200, type: ChatReadReceiptEntity })
  async markMessageRead(
    @Req() req: AuthorizedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.markMessageRead(req.user.id, id);
  }
}
