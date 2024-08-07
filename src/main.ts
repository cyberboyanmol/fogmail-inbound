import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const globalPrefix = 'api/v1';
  app.setGlobalPrefix(globalPrefix);
  try {
    app.flushLogs();
    app.enableShutdownHooks();
    const port = configService.get<number>('HTTP_PORT') || 8000;
    const host = configService.get<string>('HOST');
    await app.listen(port);
    Logger.log(
      `Fogmail Inbound service started.. on port https://${host}:${port}/${globalPrefix}`,
    );
  } catch (error) {
    Logger.warn('Error during bootstrap:', error);
    process.exit(1);
  }
}

bootstrap();
