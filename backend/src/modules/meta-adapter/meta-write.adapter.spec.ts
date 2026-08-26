import { ConfigService } from '@nestjs/config';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { MetaWriteAdapter } from './meta-write.adapter';

describe('MetaWriteAdapter', () => {
  it('enables only the exact hosted validation environment when the blueprint flag is absent', () => {
    const adapter = new MetaWriteAdapter(
      new ConfigService({
        NODE_ENV: 'production',
        BOOTSTRAP_TENANT_ID: '22222222-2222-4222-8222-222222222222',
        OPERATOR_BOOTSTRAP_SUBJECT: 'operator:warison',
      }),
      { getSecret: jest.fn() } as never,
    );

    expect(adapter.enabled()).toBe(true);
  });

  const vault = {
    getSecret: jest.fn().mockResolvedValue(JSON.stringify({
      version: 1, provider: 'meta', accessToken: 'secret-access-token',
    })),
  } as unknown as CredentialVaultPort;

  it('stays disabled unless the explicit write flag is true', async () => {
    const fetchImpl = jest.fn();
    const adapter = new MetaWriteAdapter(
      new ConfigService({ META_WRITE_ADAPTER_ENABLED: 'false' }),
      vault,
      fetchImpl as unknown as typeof fetch,
    );
    const result = await adapter.create(
      '22222222-2222-4222-8222-222222222222', 'vault/ref',
      '/act_123/campaigns', { name: 'Campaign', status: 'PAUSED' },
    );
    expect(result).toEqual(expect.objectContaining({
      success: false, normalizedError: 'VALIDATION', retryable: false,
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts only an allow-listed account edge and returns a sanitized id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: '1234567890' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const adapter = new MetaWriteAdapter(new ConfigService({
      META_WRITE_ADAPTER_ENABLED: 'true',
      META_GRAPH_BASE_URL: 'https://graph.facebook.com',
      META_GRAPH_API_VERSION: 'v26.0',
      META_APP_SECRET: 'app-secret',
    }), vault, fetchImpl as unknown as typeof fetch);
    const result = await adapter.create(
      '22222222-2222-4222-8222-222222222222', 'vault/ref',
      '/act_123/campaigns', {
        name: 'Campaign', status: 'PAUSED', special_ad_categories: [],
      },
    );
    expect(result).toEqual(expect.objectContaining({
      success: true, data: { id: '1234567890' }, retryable: false,
    }));
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://graph.facebook.com/v26.0/act_123/campaigns');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe('Bearer secret-access-token');
    const body = request.body as URLSearchParams;
    expect(body.get('status')).toBe('PAUSED');
    expect(body.get('special_ad_categories')).toBe('[]');
    expect(body.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes Meta validation errors without returning the raw body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 100, message: 'sensitive raw detail' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    const adapter = new MetaWriteAdapter(new ConfigService({
      META_WRITE_ADAPTER_ENABLED: 'true',
      META_GRAPH_BASE_URL: 'https://graph.facebook.com',
      META_GRAPH_API_VERSION: 'v26.0',
      META_APP_SECRET: 'app-secret',
    }), vault, fetchImpl as unknown as typeof fetch);
    const result = await adapter.create(
      '22222222-2222-4222-8222-222222222222', 'vault/ref',
      '/act_123/ads', { status: 'PAUSED' },
    );
    expect(result).toEqual(expect.objectContaining({
      success: false, normalizedError: 'VALIDATION', retryable: false,
    }));
    expect(JSON.stringify(result)).not.toContain('sensitive raw detail');
  });
});
