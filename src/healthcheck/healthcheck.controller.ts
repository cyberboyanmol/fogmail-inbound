import { Controller, Get } from '@nestjs/common';

@Controller('healthcheck')
export class HealthCheckController {
  constructor() {}

  @Get()
  healthcheck() {
    return 'FOGMAIL INBOUND  SERVICE IS HEALTHY ✅ 🚀.';
  }
}
