import { Controller, Get } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';

@Controller('health')
export class HealthController {
  constructor(private readonly orm: MikroORM) {}

  @Get()
  async check(): Promise<{ status: string; database: string }> {
    const database = (await this.orm.isConnected()) ? 'up' : 'down';
    return { status: database === 'up' ? 'ok' : 'degraded', database };
  }
}
