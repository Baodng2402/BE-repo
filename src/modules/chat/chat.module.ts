import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Class,
  ClassMembership,
  Conversation,
  Group,
  GroupMembership,
  Message,
  Semester,
  TeachingAssignment,
  User,
} from '../../entities';
import {
  ChatRateLimitService,
  ChatSendRateLimitGuard,
} from './chat-rate-limit.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [
    JwtModule,
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      Semester,
      Class,
      Group,
      User,
      ClassMembership,
      GroupMembership,
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
