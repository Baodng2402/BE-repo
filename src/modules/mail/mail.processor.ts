import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailJobData } from './mail.interfaces';
import { MailService } from './mail.service';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(`Processing email job ${job.id} to ${job.data.to}`);
    await this.mailService.sendRaw(job.data);
  }
}
