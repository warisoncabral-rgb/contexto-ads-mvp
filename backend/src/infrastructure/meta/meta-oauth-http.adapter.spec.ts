import { ConfigService } from '@nestjs/config';
import { MetaOAuthExchangeError } from '../../domain/ports/meta-oauth-token-exchange.port';
import { MetaOAuthHttpAdapter } from './meta-oauth-http.adapter';

describe('MetaOAuthHttpAdapter', () => {
  const values: Record<string, string> = {
    NODE_ENV: 'production',
    META_APP_ID: '123456789',
    META_APP_SECRET: 'server-only-secret',
    META_GRAPH_API_VERSION: 'v26.0',
    META_OAUTH_REDIRECT_URI: 'https://app.example/v1/meta/oauth/callback',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  const fetchMock = jest.fn();
  let adapter: MetaOAuthHttpAdapter;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    (config.get as jest.Mock).mockImplementation((key: string) => values[key]);
    adapter = new MetaOAuthHttpAdapter(config, fetchMock as typeof fetch);
  });

  it('posts to the fixed versioned Meta token endpoint with redirects disabled', async () => {
    await adapter.exchangeCode('authorization-code');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://graph.facebook.com/v26.0/oauth/access_token');
    expect(init).toEqual(expect.objectContaining({ method: 'POST', redirect: 'manual' }));
  });

  it('keeps App Secret and authorization code out of the URL', async () => {
    await adapter.exchangeCode('authorization-code');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).not.toContain('server-only-secret');
    expect(url.toString()).not.toContain('authorization-code');
    const body = init.body as URLSearchParams;
    expect(body.get('client_secret')).toBe('server-only-secret');
    expect(body.get('code')).toBe('authorization-code');
  });

  it('uses the exact server-owned redirect URI during exchange', async () => {
    await adapter.exchangeCode('authorization-code');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.body as URLSearchParams).get('redirect_uri'))
      .toBe('https://app.example/v1/meta/oauth/callback');
  });

  it('maps a successful response without exposing provider field names', async () => {
    await expect(adapter.exchangeCode('authorization-code')).resolves.toEqual({
      accessToken: 'access-token',
      tokenType: 'bearer',
      expiresIn: 3600,
    });
  });

  it.each([
    ['missing App Secret', 'META_APP_SECRET', ''],
    ['invalid App ID', 'META_APP_ID', 'app-id'],
    ['invalid API version', 'META_GRAPH_API_VERSION', 'latest'],
    ['invalid redirect URI', 'META_OAUTH_REDIRECT_URI', 'not-a-url'],
  ])('rejects %s as configuration failure without an external call', async (_label, key, value) => {
    (config.get as jest.Mock).mockImplementation((name: string) =>
      name === key ? value : values[name]);
    await expect(adapter.exchangeCode('authorization-code')).rejects.toEqual(
      expect.objectContaining({ kind: 'configuration' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sanitizes network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket detail and secret'));
    await expect(adapter.exchangeCode('authorization-code')).rejects.toEqual(
      expect.objectContaining({
        kind: 'upstream',
        message: 'Meta token exchange failed',
      }),
    );
  });

  it('rejects redirects from the token endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', {
      status: 302,
      headers: { location: 'https://attacker.example' },
    }));
    await expect(adapter.exchangeCode('authorization-code')).rejects
      .toBeInstanceOf(MetaOAuthExchangeError);
  });

  it('rejects provider errors and malformed token payloads with a sanitized error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: 'raw provider detail' },
    }), { status: 400 }));
    await expect(adapter.exchangeCode('authorization-code')).rejects.toEqual(
      expect.objectContaining({ message: 'Meta token exchange failed' }),
    );
  });

  it('rejects oversized responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(65 * 1024), { status: 200 }));
    await expect(adapter.exchangeCode('authorization-code')).rejects
      .toBeInstanceOf(MetaOAuthExchangeError);
  });
});
