import { ConfigModule } from '@nestjs/config';
import { HealthCheckController } from './healthcheck/healthcheck.controller';
import { Module } from '@nestjs/common';
import { SmtpModule } from './smtp/smtp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    SmtpModule,
  ],
  controllers: [HealthCheckController],
  providers: [],
})
export class AppModule {}
