import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { MetaOAuthService } from './meta-oauth.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';

function serviceWith(saved: any[]) {
  const config = { get: (key: string) => ({
    NODE_ENV: 'development', META_APP_ID: '123456789', META_GRAPH_API_VERSION: 'v26.0',
    META_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/meta/oauth/callback',
  } as Record<string, string>)[key] } as unknown as ConfigService;
  const connections = { getConnection: jest.fn().mockResolvedValue({
    tenantId, connectionId, provider: 'meta', status: 'authorization_pending',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }) } as unknown as MetaConnectionService;
  const attempts = { replaceActive: jest.fn(async (attempt) => saved.push(attempt)),
    consumeActive: jest.fn(), recordCredentialRevocationPending: jest.fn() } as any;
  const tokenExchange = { exchangeCode: jest.fn() } as any;
  const vault = { isAvailable: jest.fn(), putSecret: jest.fn(), getSecret: jest.fn(), revokeSecret: jest.fn() } as any;
  const store = { save: jest.fn(), findById: jest.fn(), markConnected: jest.fn() } as any;
  return new MetaOAuthService(config, connections, attempts, tokenExchange, vault, store);
}

describe('Meta OAuth scope profiles', () => {
  it('keeps read-only as the default least-privilege profile', async () => {
    const saved: any[] = [];
    const result = await serviceWith(saved).start(tenantId, connectionId);
    expect(result.scopeProfile).toBe('read_only');
    expect(result.requestedScopes).toEqual(['public_profile', 'ads_read', 'pages_show_list']);
    expect(result.requestedScopes).not.toContain('ads_management');
    expect(result.writeAuthorized).toBe(false);
  });

  it('requests ads_management only for explicit controlled write validation', async () => {
    const saved: any[] = [];
    const result = await serviceWith(saved).start(tenantId, connectionId, 'controlled_write_validation');
    expect(result.requestedScopes).toContain('ads_management');
    expect(saved[0].requestedScopes).toContain('ads_management');
    expect(result.writeAuthorized).toBe(false);
  });

  it('rejects unknown profiles fail-closed', async () => {
    const saved: any[] = [];
    await expect(serviceWith(saved).start(tenantId, connectionId, 'unknown' as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });
});
