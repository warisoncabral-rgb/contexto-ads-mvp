import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports only reachability without leaking database details', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const result = await new HealthController(pool as unknown as Pool).get();
    expect(result).toEqual({ status: 'ok', database: 'reachable' });
  });

  it('fails closed when PostgreSQL is unavailable', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('secret host')) };
    await expect(new HealthController(pool as unknown as Pool).get())
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
