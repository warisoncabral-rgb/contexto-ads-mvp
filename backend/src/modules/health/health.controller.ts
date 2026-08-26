import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  async get() {
    try {
      await this.pool.query('select 1');
      return { status: 'ok', database: 'reachable' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
