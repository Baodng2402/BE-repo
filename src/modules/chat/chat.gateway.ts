import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import {
  ChatSocketAuthService,
  ChatSocketUser,
} from './chat-socket-auth.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatRateLimitService } from './chat-rate-limit.service';

interface ChatSocket extends Socket {
  data: {
    user?: ChatSocketUser;
  };
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatSocketAuthService: ChatSocketAuthService,
    private readonly chatRateLimitService: ChatRateLimitService,
  ) {}

  async handleConnection(socket: ChatSocket) {
    try {
      const user = await this.chatSocketAuthService.authenticateSocket(socket);
      socket.data.user = user;
      await socket.join(`user:${user.id}`);
      const conversationIds = await this.chatService.listConversationIdsForUser(
        user.id,
      );
      for (const conversationId of conversationIds) {
        await socket.join(this.getConversationRoom(conversationId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unauthorized';
      this.logger.warn(
        JSON.stringify({ event: 'chat_socket_auth_failed', message }),
      );
      socket.emit('chat:error', {
        code: 'CHAT_UNAUTHORIZED',
        message,
      });
      socket.disconnect(true);
    }
  }

  handleDisconnect(_socket: ChatSocket) {}

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: { conversation_id: string } & SendChatMessageDto,
  ) {
    try {
      const user = this.requireSocketUser(socket);
      this.chatRateLimitService.consume(user.id);
      const message = await this.chatService.createMessage(
        user.id,
        payload.conversation_id,
        {
          content: payload.content,
          type: payload.type,
          client_id: payload.client_id,
        },
      );
      await socket.join(this.getConversationRoom(payload.conversation_id));
      this.server
        .to(this.getConversationRoom(payload.conversation_id))
        .emit('chat:new', message);
      return message;
    } catch (error) {
      const response = this.toSocketError(error);
      socket.emit('chat:error', response);
      return response;
    }
  }

  @SubscribeMessage('chat:read')
  async handleRead(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: { conversation_id: string },
  ) {
    try {
      const user = this.requireSocketUser(socket);
      const receipt = await this.chatService.markConversationRead(
        user.id,
        payload.conversation_id,
      );
      await socket.join(this.getConversationRoom(payload.conversation_id));
      this.server
        .to(this.getConversationRoom(payload.conversation_id))
        .emit('chat:read', receipt);
      return receipt;
    } catch (error) {
      const response = this.toSocketError(error);
      socket.emit('chat:error', response);
      return response;
    }
  }

  @SubscribeMessage('chat:typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: { conversation_id: string },
  ) {
    return this.handleTyping(socket, payload.conversation_id, true);
  }

  @SubscribeMessage('chat:typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: { conversation_id: string },
  ) {
    return this.handleTyping(socket, payload.conversation_id, false);
  }

  private async handleTyping(
    socket: ChatSocket,
    conversationId: string,
    isTyping: boolean,
  ) {
    try {
      const user = this.requireSocketUser(socket);
      await this.chatService.assertRealtimeAccess(user.id, conversationId);
      await socket.join(this.getConversationRoom(conversationId));
      socket.to(this.getConversationRoom(conversationId)).emit('chat:typing', {
        conversation_id: conversationId,
        sender_id: user.id,
        is_typing: isTyping,
      });
      return { ok: true };
    } catch (error) {
      const response = this.toSocketError(error);
      socket.emit('chat:error', response);
      return response;
    }
  }

  private requireSocketUser(socket: ChatSocket) {
    const user = socket.data.user;
    if (!user) {
      throw new Error('Socket user context is missing');
    }
    return user;
  }

  private getConversationRoom(conversationId: string) {
    return `conversation:${conversationId}`;
  }

  private toSocketError(error: unknown) {
    if (typeof error === 'object' && error && 'response' in error) {
      const response = (error as { response?: unknown }).response;
      if (typeof response === 'object' && response) {
        return response;
      }
    }
    return {
      code: 'CHAT_ERROR',
      message:
        error instanceof Error ? error.message : 'Chat operation failed.',
    };
  }
}
