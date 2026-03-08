import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailProcessor } from './mail.processor';
import { MailService } from './mail.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'email' })],
  providers: [MailService, EmailProcessor],
  exports: [MailService],
})
export class MailModule {}
