import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailUtilitiesService } from './mail-utilities.service';
import { SmtpService } from './smtp.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [],
  providers: [MailUtilitiesService, SmtpService],
  exports: [SmtpService],
})
export class SmtpModule {}
