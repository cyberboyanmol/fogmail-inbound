import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailUtilitiesService } from './mail-utilities.service';
import { SmtpService } from './smtp.service';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from 'src/libraries/queues/bullmq-queue.module';
import { INBOUND_MAIL_PARSE_QUEUE } from 'src/libraries/queues/queues';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      defaultJobOptions: {
        removeOnComplete: { age: 50, count: 2 },
        removeOnFail: { age: 50, count: 10 },
        attempts: 3,
      },
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
        username: process.env.REDIS_USER,
        password: process.env.REDIS_PASS,
      },
    }),
    QueueModule.register({
      queues: [INBOUND_MAIL_PARSE_QUEUE],
    }),
  ],
  controllers: [],
  providers: [MailUtilitiesService, SmtpService],
  exports: [SmtpService],
})
export class SmtpModule {}
