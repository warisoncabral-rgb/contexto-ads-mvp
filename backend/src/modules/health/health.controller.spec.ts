import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { HealthController } from './health.controller';

function controller(overrides: Record<string, string> = {}, query = jest.fn().mockResolvedValue({ rows: [{ ok: 1 }] })) {
  const values: Record<string, string> = {
    OPERATOR_BOOTSTRAP_SUBJECT: 'operator-1',
    OPERATOR_BOOTSTRAP_TOKEN_SHA256: 'a'.repeat(64),
    META_APP_ID: '123456789',
    META_APP_SECRET: 'secret-value-long-enough',
    META_OAUTH_REDIRECT_URI: 'https://api.contexto.example/v1/meta/oauth/callback',
    CONTEXT_ADS_FRONTEND_BASE_URL: 'https://app.contexto.example',
    ...overrides,
  };
  const pool = { query } as unknown as Pool;
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  return new HealthController(pool, config);
}

describe('HealthController', () => {
  it('liveness never claims external writes are enabled', () => {
    expect(controller().live()).toEqual({
      status: 'ok', service: 'contexto-ads-backend', externalWritesEnabled: false,
    });
  });

  it('reports core readiness without exposing secret values', async () => {
    const result = await controller().ready();
    expect(result).toEqual(expect.objectContaining({
      status: 'ready', databaseReachable: true, operatorBootstrapConfigured: true,
      metaEnvironmentConfigured: true, externalWritesEnabled: false,
    }));
    expect(JSON.stringify(result)).not.toContain('secret-value-long-enough');
  });

  it('reports Meta environment absent without making the process unhealthy', async () => {
    const result = await controller({ META_APP_SECRET: '' }).ready();
    expect(result.status).toBe('ready');
    expect(result.metaEnvironmentConfigured).toBe(false);
    expect(result.externalWritesEnabled).toBe(false);
  });

  it('fails readiness when PostgreSQL is unreachable', async () => {
    const query = jest.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(controller({}, query).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
