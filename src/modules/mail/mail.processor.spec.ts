import { Test, TestingModule } from '@nestjs/testing';
import { EmailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { Job } from 'bullmq';
import { EmailJobData } from './mail.interfaces';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let mockMailService: { sendRaw: jest.Mock };

  beforeEach(async () => {
    mockMailService = { sendRaw: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    processor = module.get<EmailProcessor>(EmailProcessor);
  });

  it('should call mailService.sendRaw with job data', async () => {
    const jobData: EmailJobData = {
      to: 'test@test.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    };
    const mockJob = { data: jobData } as Job<EmailJobData>;

    await processor.process(mockJob);

    expect(mockMailService.sendRaw).toHaveBeenCalledWith(jobData);
  });

  it('should propagate errors from sendRaw', async () => {
    mockMailService.sendRaw.mockRejectedValue(new Error('SMTP failed'));
    const mockJob = {
      data: { to: 'x@x.com', subject: 's', html: 'h' },
    } as Job<EmailJobData>;

    await expect(processor.process(mockJob)).rejects.toThrow('SMTP failed');
  });
});
