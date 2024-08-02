import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SMTPServer } from 'smtp-server';
@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  private smtp: SMTPServer;
  constructor() {}

  onModuleInit() {}
  onModuleDestroy() {}
}
