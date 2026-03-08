import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: getQueueToken('email'), useValue: mockQueue },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const config: Record<string, string> = {
                SMTP_HOST: 'smtp.test.com',
                SMTP_PORT: '587',
                SMTP_USER: 'test@test.com',
                SMTP_PASS: 'password',
                SMTP_FROM: 'noreply@test.com',
              };
              return config[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  describe('queueEmail', () => {
    it('should add a job to the email queue', async () => {
      await service.queueEmail('user@test.com', 'Test Subject', '<p>Hello</p>');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-email',
        {
          to: 'user@test.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });
  });

  describe('sendRaw', () => {
    it('should be defined', () => {
      expect(service.sendRaw.bind(service)).toBeDefined();
    });
  });
});
