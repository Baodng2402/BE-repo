import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ChatController } from '../src/modules/chat/chat.controller';
import { ChatRateLimitService } from '../src/modules/chat/chat-rate-limit.service';
import { ChatService } from '../src/modules/chat/chat.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

describe('ChatController (e2e)', () => {
  let app: INestApplication<App>;
  const chatService = {
    getOrCreateConversation: jest.fn(),
    listConversations: jest.fn(),
    listMessages: jest.fn(),
    createMessage: jest.fn(),
    markConversationRead: jest.fn(),
    markMessageRead: jest.fn(),
  };

  class MockJwtGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      const role = req.headers['x-role'] || 'STUDENT';
      const userId = req.headers['x-user-id'] || 'student-1';
      req.user = { id: userId, role };
      return true;
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: ChatRateLimitService, useValue: { consume: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('gets or creates a conversation for a student', async () => {
    chatService.getOrCreateConversation.mockResolvedValue({ id: 'conv-1' });

    await request(app.getHttpServer())
      .post('/chat/conversations')
      .send({
        semester_id: '11111111-1111-1111-1111-111111111111',
        class_id: '22222222-2222-2222-2222-222222222222',
        student_id: '33333333-3333-3333-3333-333333333333',
        lecturer_id: '44444444-4444-4444-4444-444444444444',
      })
      .expect(201);
  });

  it('lists conversations for the current lecturer', async () => {
    chatService.listConversations.mockResolvedValue({ data: [] });

    await request(app.getHttpServer())
      .get('/chat/conversations')
      .set('x-role', 'LECTURER')
      .set('x-user-id', 'lecturer-1')
      .expect(200);
  });

  it('sends and reads messages through REST endpoints', async () => {
    chatService.createMessage.mockResolvedValue({ id: 'msg-1' });
    chatService.markConversationRead.mockResolvedValue({
      conversation_id: 'conv-1',
      read_count: 1,
    });

    await request(app.getHttpServer())
      .post('/chat/conversations/11111111-1111-1111-1111-111111111111/messages')
      .send({ content: 'Hello teacher' })
      .expect(201);

    await request(app.getHttpServer())
      .patch('/chat/conversations/11111111-1111-1111-1111-111111111111/read')
      .expect(200);
  });
});
