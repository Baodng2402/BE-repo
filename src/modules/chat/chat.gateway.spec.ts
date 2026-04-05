import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';

describe('ChatGateway', () => {
  let app: INestApplication;
  let port: number;
  let studentClient: ClientSocket;
  let lecturerClient: ClientSocket;

  const chatService = {
    listConversationIdsForUser: jest.fn(() => Promise.resolve(['conv-1'])),
    createMessage: jest.fn((userId: string, conversationId: string, dto: any) =>
      Promise.resolve({
        id: `msg-${userId}`,
        conversation_id: conversationId,
        sender_id: userId,
        content: dto.content,
        created_at: '2026-03-27T10:00:00.000Z',
        client_id: dto.client_id || null,
      }),
    ),
    markConversationRead: jest.fn((_userId: string, conversationId: string) =>
      Promise.resolve({
        conversation_id: conversationId,
        read_count: 1,
        read_at: '2026-03-27T10:01:00.000Z',
      }),
    ),
    assertRealtimeAccess: jest.fn(() => Promise.resolve({ id: 'conv-1' })),
  };

  const authService = {
    authenticateSocket: jest.fn((socket: any) => {
      if (socket.handshake.auth.token === 'student-token') {
        return {
          id: 'student-1',
          role: 'STUDENT',
          email: 'student@fpt.edu.vn',
        };
      }
      if (socket.handshake.auth.token === 'lecturer-token') {
        return {
          id: 'lecturer-1',
          role: 'LECTURER',
          email: 'lecturer@fpt.edu.vn',
        };
      }
      throw new Error('Unauthorized');
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: chatService },
        { provide: ChatSocketAuthService, useValue: authService },
        ChatRateLimitService,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = app.getHttpServer().address().port;
  });

  afterEach(async () => {
    studentClient?.disconnect();
    lecturerClient?.disconnect();
    await app.close();
    jest.clearAllMocks();
  });

  it('broadcasts new messages and typing events inside the conversation room', async () => {
    studentClient = Client(`http://127.0.0.1:${port}/chat`, {
      auth: { token: 'student-token' },
      transports: ['websocket'],
    });
    lecturerClient = Client(`http://127.0.0.1:${port}/chat`, {
      auth: { token: 'lecturer-token' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) =>
        studentClient.on('connect', () => resolve()),
      ),
      new Promise<void>((resolve) =>
        lecturerClient.on('connect', () => resolve()),
      ),
    ]);

    const typingPromise = new Promise<any>((resolve) => {
      lecturerClient.once('chat:typing', resolve);
    });
    studentClient.emit('chat:typing:start', { conversation_id: 'conv-1' });
    const typingPayload = await typingPromise;
    expect(typingPayload).toMatchObject({
      conversation_id: 'conv-1',
      sender_id: 'student-1',
      is_typing: true,
    });

    const messagePromise = new Promise<any>((resolve) => {
      lecturerClient.once('chat:new', resolve);
    });
    studentClient.emit('chat:send', {
      conversation_id: 'conv-1',
      content: 'Hello teacher',
      client_id: 'mobile-msg-1',
    });
    const messagePayload = await messagePromise;
    expect(messagePayload).toMatchObject({
      conversation_id: 'conv-1',
      sender_id: 'student-1',
      content: 'Hello teacher',
      client_id: 'mobile-msg-1',
    });
  });
});
