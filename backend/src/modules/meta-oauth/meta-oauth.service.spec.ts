import {
  BadGatewayException,
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
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import {
  MetaOAuthExchangeError,
  MetaOAuthTokenExchangePort,
} from '../../domain/ports/meta-oauth-token-exchange.port';
import { MetaConnectionStore } from '../../domain/ports/repositories';
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
  const validState = 's'.repeat(43);
  const consumedAttempt: MetaOAuthAttempt = {
    attemptId: '33333333-3333-4333-8333-333333333333',
    tenantId,
    connectionId,
    stateHash: createHash('sha256').update(validState).digest('hex'),
    requestedScopes: ['public_profile', 'ads_read', 'pages_show_list'],
    createdAt: '2026-08-19T02:00:00.000Z',
    expiresAt: '2026-08-19T02:10:00.000Z',
    consumedAt: '2026-08-19T02:01:00.000Z',
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
  let tokenExchange: jest.Mocked<MetaOAuthTokenExchangePort>;
  let vault: jest.Mocked<CredentialVaultPort>;
  let connectionStore: jest.Mocked<MetaConnectionStore>;
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
      consumeActive: jest.fn().mockResolvedValue(consumedAttempt),
      recordCredentialRevocationPending: jest.fn().mockResolvedValue(undefined),
    };
    tokenExchange = {
      exchangeCode: jest.fn().mockResolvedValue({
        accessToken: 'secret-access-token',
        tokenType: 'bearer',
        expiresIn: 3600,
      }),
    };
    vault = {
      isAvailable: jest.fn().mockResolvedValue(true),
      putSecret: jest.fn().mockResolvedValue('vault://credential-1'),
      getSecret: jest.fn(),
      revokeSecret: jest.fn().mockResolvedValue(undefined),
    };
    connectionStore = {
      save: jest.fn(),
      findById: jest.fn(),
      latestReadyForTenant: jest.fn(),
      markConnected: jest.fn().mockResolvedValue(true),
    };
    service = new MetaOAuthService(
      config as unknown as ConfigService,
      connections as unknown as MetaConnectionService,
      attempts,
      tokenExchange,
      vault,
      connectionStore,
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
    expect(url.searchParams.get('scope')).toBe('public_profile,ads_read,pages_show_list');
    expect(url.searchParams.has('auth_type')).toBe(false);
  });

  it('starts an explicit ads_management rerequest on the existing connection', async () => {
    connections.getConnection.mockResolvedValueOnce({
      ...connection,
      status: 'connected',
      credentialRef: 'vault://current-credential',
    });

    const result = await service.startExecutionAuthorization(tenantId, connectionId);
    const url = new URL(result.authorizationUrl);

    expect(url.searchParams.get('scope')).toBe(
      'public_profile,ads_read,pages_show_list,ads_management',
    );
    expect(url.searchParams.get('auth_type')).toBe('rerequest');
    expect(saved[0].requestedScopes).toEqual([
      'public_profile', 'ads_read', 'pages_show_list', 'ads_management',
    ]);
  });

  it('refuses permission expansion without an existing connected credential', async () => {
    await expect(service.startExecutionAuthorization(tenantId, connectionId)).rejects
      .toBeInstanceOf(ConflictException);
    expect(attempts.replaceActive).not.toHaveBeenCalled();
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

  it('rejects a callback without state before any persistence or external call', async () => {
    await expect(service.callback({ code: 'code-1' })).rejects
      .toBeInstanceOf(BadRequestException);
    expect(attempts.consumeActive).not.toHaveBeenCalled();
    expect(tokenExchange.exchangeCode).not.toHaveBeenCalled();
  });

  it('hashes and atomically consumes the state before exchanging the code', async () => {
    const order: string[] = [];
    attempts.consumeActive.mockImplementationOnce(async () => {
      order.push('consume');
      return consumedAttempt;
    });
    tokenExchange.exchangeCode.mockImplementationOnce(async () => {
      order.push('exchange');
      return { accessToken: 'secret-access-token' };
    });

    await service.callback({ state: validState, code: 'code-1' });

    expect(attempts.consumeActive).toHaveBeenCalledWith(consumedAttempt.stateHash);
    expect(order).toEqual(['consume', 'exchange']);
  });

  it('rejects expired, invalidated, consumed, or unknown state without exchanging code', async () => {
    attempts.consumeActive.mockResolvedValueOnce(null);
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(BadRequestException);
    expect(tokenExchange.exchangeCode).not.toHaveBeenCalled();
    expect(vault.putSecret).not.toHaveBeenCalled();
  });

  it('prevents replay after a prior state consumption', async () => {
    attempts.consumeActive
      .mockResolvedValueOnce(consumedAttempt)
      .mockResolvedValueOnce(null);

    await service.callback({ state: validState, code: 'code-1' });
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(BadRequestException);
    expect(tokenExchange.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('consumes provider cancellation without exchanging or storing a token', async () => {
    await expect(service.callback({ state: validState, error: 'access_denied' })).rejects
      .toThrow('Meta authorization was not completed');
    expect(attempts.consumeActive).toHaveBeenCalledTimes(1);
    expect(tokenExchange.exchangeCode).not.toHaveBeenCalled();
    expect(vault.putSecret).not.toHaveBeenCalled();
    expect(connectionStore.markConnected).not.toHaveBeenCalled();
  });

  it('handles provider cancellation even when the production Vault is unavailable', async () => {
    vault.isAvailable.mockResolvedValueOnce(false);
    await expect(service.callback({ state: validState, error: 'access_denied' })).rejects
      .toThrow('Meta authorization was not completed');
    expect(attempts.consumeActive).toHaveBeenCalledTimes(1);
    expect(vault.putSecret).not.toHaveBeenCalled();
  });

  it('rejects ambiguous code and error before consuming state', async () => {
    await expect(service.callback({
      state: validState,
      code: 'code-1',
      error: 'access_denied',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(attempts.consumeActive).not.toHaveBeenCalled();
  });

  it('keeps the success path disabled when no concrete Vault is available', async () => {
    vault.isAvailable.mockResolvedValueOnce(false);
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(attempts.consumeActive).not.toHaveBeenCalled();
    expect(tokenExchange.exchangeCode).not.toHaveBeenCalled();
  });

  it('maps invalid Meta configuration to service unavailable', async () => {
    tokenExchange.exchangeCode.mockRejectedValueOnce(
      new MetaOAuthExchangeError('configuration', 'contains no secret'),
    );
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(vault.putSecret).not.toHaveBeenCalled();
  });

  it('sanitizes upstream token exchange failures', async () => {
    tokenExchange.exchangeCode.mockRejectedValueOnce(
      new MetaOAuthExchangeError('upstream', 'raw provider detail'),
    );
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toEqual(expect.objectContaining({
        constructor: BadGatewayException,
        message: 'Meta authorization could not be completed',
      }));
    expect(vault.putSecret).not.toHaveBeenCalled();
  });

  it('stores a versioned token payload only through the tenant-scoped Vault port', async () => {
    await service.callback({ state: validState, code: 'code-1' });
    expect(vault.putSecret).toHaveBeenCalledWith(tenantId, expect.any(String));
    const payload = JSON.parse(vault.putSecret.mock.calls[0][1]);
    expect(payload).toEqual(expect.objectContaining({
      version: 1,
      provider: 'meta',
      accessToken: 'secret-access-token',
      tokenType: 'bearer',
      obtainedAt: expect.any(String),
      expiresAt: expect.any(String),
    }));
  });

  it('persists only credentialRef and transitions the tenant-scoped connection', async () => {
    const result = await service.callback({ state: validState, code: 'code-1' });
    expect(connectionStore.markConnected).toHaveBeenCalledWith(
      tenantId,
      connectionId,
      'vault://credential-1',
      expect.any(String),
      false,
    );
    expect(JSON.stringify(connectionStore.markConnected.mock.calls)).not
      .toContain('secret-access-token');
    expect(result).toEqual({ status: 'connected', connectionId });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });

  it('finalizes an ads_management rerequest on the same connection', async () => {
    attempts.consumeActive.mockResolvedValueOnce({
      ...consumedAttempt,
      requestedScopes: [...consumedAttempt.requestedScopes, 'ads_management'],
    });

    await service.callback({ state: validState, code: 'code-1' });

    expect(connectionStore.markConnected).toHaveBeenCalledWith(
      tenantId,
      connectionId,
      'vault://credential-1',
      expect.any(String),
      true,
    );
  });

  it('does not update the connection when Vault persistence fails', async () => {
    vault.putSecret.mockRejectedValueOnce(new Error('vault detail'));
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(connectionStore.markConnected).not.toHaveBeenCalled();
  });

  it('revokes the Vault credential when the connection update returns false', async () => {
    connectionStore.markConnected.mockResolvedValueOnce(false);
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(vault.revokeSecret).toHaveBeenCalledWith(tenantId, 'vault://credential-1');
    expect(attempts.recordCredentialRevocationPending).not.toHaveBeenCalled();
  });

  it('revokes the Vault credential when the connection update throws', async () => {
    connectionStore.markConnected.mockRejectedValueOnce(new Error('database detail'));
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(vault.revokeSecret).toHaveBeenCalledWith(tenantId, 'vault://credential-1');
  });

  it('preserves the sanitized failure even when compensation also fails', async () => {
    connectionStore.markConnected.mockResolvedValueOnce(false);
    vault.revokeSecret.mockRejectedValueOnce(new Error('revoke detail'));
    await expect(service.callback({ state: validState, code: 'code-1' })).rejects
      .toThrow('Meta connection could not be finalized');
    expect(attempts.recordCredentialRevocationPending).toHaveBeenCalledWith(
      tenantId,
      connectionId,
      'vault://credential-1',
      expect.any(String),
    );
    expect(JSON.stringify(attempts.recordCredentialRevocationPending.mock.calls)).not
      .toContain('secret-access-token');
  });

  it('sanitizes a failure to persist the pending credential revocation', async () => {
    connectionStore.markConnected.mockResolvedValueOnce(false);
    vault.revokeSecret.mockRejectedValueOnce(new Error('raw revoke detail'));
    attempts.recordCredentialRevocationPending.mockRejectedValueOnce(
      new Error('raw database detail'),
    );

    await expect(service.callback({ state: validState, code: 'authorization-code' }))
      .rejects.toEqual(expect.objectContaining({
        constructor: ServiceUnavailableException,
        message: 'Meta connection could not be finalized',
      }));
  });
});
