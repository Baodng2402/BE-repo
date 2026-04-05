import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Class,
  ClassMembership,
  Conversation,
  Message,
  Semester,
  TeachingAssignment,
  User,
} from '../../entities';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import {
  ChatRateLimitService,
  ChatSendRateLimitGuard,
} from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';

@Module({
  imports: [
    JwtModule,
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      Semester,
      Class,
      User,
      ClassMembership,
      TeachingAssignment,
    ]),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatSocketAuthService,
    ChatRateLimitService,
    ChatSendRateLimitGuard,
  ],
})
export class ChatModule {}
