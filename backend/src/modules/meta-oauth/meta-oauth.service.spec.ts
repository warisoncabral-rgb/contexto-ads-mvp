import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaOAuthAttempt } from '../../domain/contracts/meta-oauth-attempt';
import { MetaOAuthAttemptStore } from '../../domain/ports/repositories';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { MetaOAuthService } from './meta-oauth.service';

describe('MetaOAuthService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';
  const connection: MetaConnection = {
    tenantId,
    connectionId,
    provider: 'meta',
    status: 'authorization_pending',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  const values: Record<string, string> = {
    NODE_ENV: 'development',
    META_APP_ID: '123456789',
    META_GRAPH_API_VERSION: 'v26.0',
    META_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/meta/oauth/callback',
    META_APP_SECRET: 'must-not-be-used',
  };
  let config: { get: jest.Mock };
  let connections: jest.Mocked<Pick<MetaConnectionService, 'getConnection'>>;
  let attempts: jest.Mocked<MetaOAuthAttemptStore>;
  let saved: MetaOAuthAttempt[];
  let service: MetaOAuthService;

  beforeEach(() => {
    saved = [];
    config = { get: jest.fn((key: string) => values[key]) };
    connections = { getConnection: jest.fn().mockResolvedValue(connection) };
    attempts = {
      replaceActive: jest.fn(async (attempt: MetaOAuthAttempt) => {
        saved.push(attempt);
      }),
    };
    service = new MetaOAuthService(
      config as unknown as ConfigService,
      connections as unknown as MetaConnectionService,
      attempts,
    );
  });

  it('creates and persists an OAuth attempt for an authorization_pending connection', async () => {
    const result = await service.start(tenantId, connectionId);

    expect(attempts.replaceActive).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      attemptId: saved[0].attemptId,
      connectionId,
      authorizationUrl: expect.any(String),
      expiresAt: saved[0].expiresAt,
      externalCallPerformed: false,
    }));
  });

  it('builds the Meta authorization URL from fixed server-owned parameters', async () => {
    const result = await service.start(tenantId, connectionId);
    const url = new URL(result.authorizationUrl);

    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v26.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('123456789');
    expect(url.searchParams.get('redirect_uri'))
      .toBe('http://localhost:3000/v1/meta/oauth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('public_profile');
  });

  it('persists only the SHA-256 digest of the generated state', async () => {
    const result = await service.start(tenantId, connectionId);
    const state = new URL(result.authorizationUrl).searchParams.get('state')!;

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved[0].stateHash).toBe(createHash('sha256').update(state).digest('hex'));
  });

  it('does not persist the raw state', async () => {
    const result = await service.start(tenantId, connectionId);
    const state = new URL(result.authorizationUrl).searchParams.get('state')!;

    expect(JSON.stringify(saved[0])).not.toContain(state);
  });

  it('uses a fixed ten-minute TTL', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T02:00:00.000Z'));
    try {
      await service.start(tenantId, connectionId);
      expect(saved[0].createdAt).toBe('2026-08-19T02:00:00.000Z');
      expect(saved[0].expiresAt).toBe('2026-08-19T02:10:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('binds the attempt to the tenant and connection returned by the scoped lookup', async () => {
    await service.start(tenantId, connectionId);

    expect(connections.getConnection).toHaveBeenCalledWith(tenantId, connectionId);
    expect(saved[0]).toEqual(expect.objectContaining({ tenantId, connectionId }));
  });

  it('generates a different state for each attempt', async () => {
    const first = await service.start(tenantId, connectionId);
    const second = await service.start(tenantId, connectionId);

    expect(new URL(first.authorizationUrl).searchParams.get('state'))
      .not.toBe(new URL(second.authorizationUrl).searchParams.get('state'));
  });

  it('keeps the App Secret entirely outside the attempt and authorization URL', async () => {
    const result = await service.start(tenantId, connectionId);

    expect(config.get).not.toHaveBeenCalledWith('META_APP_SECRET');
    expect(result.authorizationUrl).not.toContain(values.META_APP_SECRET);
    expect(JSON.stringify(saved[0])).not.toContain(values.META_APP_SECRET);
  });

  it('returns conflict when the connection is not authorization_pending', async () => {
    connections.getConnection.mockResolvedValueOnce({ ...connection, status: 'connected' });

    await expect(service.start(tenantId, connectionId)).rejects
      .toBeInstanceOf(ConflictException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
  });

  it('preserves bad request for an invalid tenantId before persistence', async () => {
    connections.getConnection.mockRejectedValueOnce(
      new BadRequestException('tenantId must be a valid UUID'),
    );

    await expect(service.start('tenant-1', connectionId)).rejects
      .toBeInstanceOf(BadRequestException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
  });

  it('preserves bad request for an invalid connectionId before persistence', async () => {
    connections.getConnection.mockRejectedValueOnce(
      new BadRequestException('connectionId must be a valid UUID'),
    );

    await expect(service.start(tenantId, 'connection-1')).rejects
      .toBeInstanceOf(BadRequestException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
  });

  it('preserves not found for a missing or cross-tenant connection', async () => {
    connections.getConnection.mockRejectedValueOnce(
      new NotFoundException('Meta connection not found'),
    );

    await expect(service.start(tenantId, connectionId)).rejects
      .toBeInstanceOf(NotFoundException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
  });

  it.each([
    ['missing App ID', { META_APP_ID: '' }],
    ['invalid API version', { META_GRAPH_API_VERSION: 'latest' }],
    ['malformed redirect URI', { META_OAUTH_REDIRECT_URI: 'not-a-url' }],
    ['redirect URI with fragment', {
      META_OAUTH_REDIRECT_URI: 'https://example.com/v1/meta/oauth/callback#fragment',
    }],
    ['HTTP redirect URI outside local development', {
      NODE_ENV: 'production',
      META_OAUTH_REDIRECT_URI: 'http://example.com/v1/meta/oauth/callback',
    }],
  ])('returns service unavailable for %s without persistence', async (_label, overrides) => {
    const invalidValues: Record<string, string> = { ...values, ...overrides };
    config.get.mockImplementation((key: string) => invalidValues[key]);

    await expect(service.start(tenantId, connectionId)).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
  });
});
