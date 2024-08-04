import { NestFactory } from '@nestjs/core';

import { SmtpModule } from './smtp/smtp.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(SmtpModule);
    app.flushLogs();
    app.enableShutdownHooks();
  } catch (error) {
    Logger.warn('Error during bootstrap:', error);
    process.exit(1);
  }
}

bootstrap();
