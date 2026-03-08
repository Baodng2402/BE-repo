import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createTransport, Transporter } from 'nodemailer';
import { EmailJobData } from './mail.interfaces';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.transporter = createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: parseInt(this.configService.get<string>('SMTP_PORT', '587'), 10),
      secure: false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async queueEmail(to: string, subject: string, html: string): Promise<void> {
    await this.emailQueue.add(
      'send-email',
      { to, subject, html } satisfies EmailJobData,
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
    this.logger.log(`Queued email to ${to}: ${subject}`);
  }

  async sendRaw(data: EmailJobData): Promise<void> {
    const from = this.configService.get<string>(
      'SMTP_FROM',
      'noreply@wdp301.com',
    );
    await this.transporter.sendMail({
      from,
      to: data.to,
      subject: data.subject,
      html: data.html,
    });
    this.logger.log(`Sent email to ${data.to}: ${data.subject}`);
  }
}
