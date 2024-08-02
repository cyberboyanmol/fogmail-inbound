import { NestFactory } from '@nestjs/core';

import { SmtpModule } from './smtp/smtp.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SmtpModule);
  app.enableShutdownHooks();
}

bootstrap();
