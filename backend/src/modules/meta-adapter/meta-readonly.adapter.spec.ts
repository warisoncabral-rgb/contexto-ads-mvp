import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { MetaReadonlyAdapter } from './meta-readonly.adapter';

describe('MetaReadonlyAdapter', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const credentialRef = 'postgres-vault://22222222-2222-4222-8222-222222222222';
  const accessToken = 'server-only-access-token';
  const appSecret = 'server-only-app-secret';
  const values: Record<string, string> = {
    META_APP_ID: '123456789',
    META_APP_SECRET: appSecret,
    META_GRAPH_API_VERSION: 'v26.0',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  const vault = {
    isAvailable: jest.fn(),
    putSecret: jest.fn(),
    getSecret: jest.fn().mockResolvedValue(JSON.stringify({
      version: 1,
      provider: 'meta',
      accessToken,
    })),
    revokeSecret: jest.fn(),
  } as unknown as jest.Mocked<CredentialVaultPort>;
  const fetchMock = jest.fn();
  let adapter: MetaReadonlyAdapter;

  const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers });

  beforeEach(() => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockImplementation((key: string) => values[key]);
    vault.getSecret.mockResolvedValue(JSON.stringify({
      version: 1,
      provider: 'meta',
      accessToken,
    }));
    fetchMock.mockResolvedValue(json({ id: '123' }));
    adapter = new MetaReadonlyAdapter(config, vault, fetchMock as typeof fetch);
  });

  it('validates identity using a tenant-scoped Vault credential', async () => {
    await expect(adapter.validateConnection(tenantId, credentialRef)).resolves
      .toEqual(expect.objectContaining({
        success: true,
        data: { subjectId: '123' },
      }));
    expect(vault.getSecret).toHaveBeenCalledWith(tenantId, credentialRef);
  });

  it('keeps the token out of the URL and sends appsecret_proof', async () => {
    await adapter.validateConnection(tenantId, credentialRef);
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const expectedProof = createHmac('sha256', appSecret).update(accessToken).digest('hex');

    expect(input.origin).toBe('https://graph.facebook.com');
    expect(input.pathname).toBe('/v26.0/me');
    expect(input.toString()).not.toContain(accessToken);
    expect(input.searchParams.get('appsecret_proof')).toBe(expectedProof);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${accessToken}`);
    expect(init).toEqual(expect.objectContaining({ method: 'GET', redirect: 'manual' }));
  });

  it('discovers paginated ad accounts and pages through fixed edges', async () => {
    fetchMock.mockImplementation(async (input: URL) => {
      if (input.pathname.endsWith('/adaccounts') && !input.searchParams.has('after')) {
        return json({
          data: [{ id: 'act_123', name: 'Primary ads' }],
          paging: { cursors: { after: 'cursor-1' } },
        });
      }
      if (input.pathname.endsWith('/adaccounts')) {
        return json({ data: [{ id: 'act_456', name: 'Secondary ads' }] });
      }
      if (input.pathname.endsWith('/accounts')) {
        return json({ data: [{ id: '789', name: 'Main page' }] });
      }
      return json({
        id: '789',
        name: 'Main page',
        has_whatsapp_number: true,
        whatsapp_number: '+55 83 99999-0000',
      });
    });

    const result = await adapter.discoverAssets(credentialRef, tenantId);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: [
        { assetType: 'ad_account', externalId: 'act_123', displayName: 'Primary ads' },
        { assetType: 'ad_account', externalId: 'act_456', displayName: 'Secondary ads' },
        { assetType: 'facebook_page', externalId: '789', displayName: 'Main page' },
        { assetType: 'whatsapp', externalId: '5583999990000',
          displayName: 'WhatsApp · Main page' },
      ],
    }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const cursorRequest = (fetchMock.mock.calls as Array<[URL]>).find(([url]) =>
      url.searchParams.get('after') === 'cursor-1');
    expect(cursorRequest).toBeDefined();
  });

  it('uses an ephemeral Page token to discover the linked WhatsApp number', async () => {
    const pageAccessToken = 'page-only-access-token-123456';
    fetchMock.mockImplementation(async (input: URL, init?: RequestInit) => {
      if (input.pathname.endsWith('/adaccounts')) return json({ data: [] });
      if (input.pathname.endsWith('/accounts')) {
        expect(input.searchParams.get('fields')).toBe('id,name,access_token');
        return json({ data: [{
          id: '789',
          name: 'Main page',
          access_token: pageAccessToken,
        }] });
      }
      expect((init?.headers as Record<string, string>).authorization)
        .toBe(`Bearer ${pageAccessToken}`);
      expect(input.searchParams.get('appsecret_proof')).toBe(
        createHmac('sha256', appSecret).update(pageAccessToken).digest('hex'),
      );
      return json({
        id: '789',
        name: 'Main page',
        has_whatsapp_number: true,
        whatsapp_number: '+55 83 99999-0000',
      });
    });

    await expect(adapter.discoverAssets(credentialRef, tenantId)).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: [
          { assetType: 'facebook_page', externalId: '789', displayName: 'Main page' },
          { assetType: 'whatsapp', externalId: '5583999990000',
            displayName: 'WhatsApp · Main page' },
        ],
      }),
    );
  });

  it('falls back to pages promotable by the discovered ad account', async () => {
    fetchMock.mockImplementation(async (input: URL) => {
      if (input.pathname.endsWith('/adaccounts')) {
        return json({ data: [{ id: 'act_123', name: 'Primary ads' }] });
      }
      if (input.pathname.endsWith('/accounts')) return json({ data: [] });
      if (input.pathname.endsWith('/promote_pages')) {
        return json({ data: [{ id: '789', name: 'Promotable page' }] });
      }
      return json({ id: '789', name: 'Promotable page', has_whatsapp_number: false });
    });

    await expect(adapter.discoverAssets(credentialRef, tenantId)).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          { assetType: 'facebook_page', externalId: '789', displayName: 'Promotable page' },
        ]),
      }),
    );
    expect((fetchMock.mock.calls as Array<[URL]>).some(([url]) =>
      url.pathname.endsWith('/act_123/promote_pages'))).toBe(true);
  });

  it('fails closed instead of persisting partial discovery', async () => {
    fetchMock.mockImplementation(async (input: URL) => input.pathname.endsWith('/adaccounts')
      ? json({ data: [{ id: 'act_123', name: 'Ads' }] })
      : json({ error: { code: 200, message: 'raw permission detail' } }, 403));

    await expect(adapter.discoverAssets(credentialRef, tenantId)).resolves.toEqual(
      expect.objectContaining({
        success: false,
        retryable: false,
        normalizedError: 'AUTH_PERMISSION',
      }),
    );
  });

  it('classifies rate limits and server failures as retryable', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 613 } }, 429));
    await expect(adapter.validateConnection(tenantId, credentialRef)).resolves.toEqual(
      expect.objectContaining({
        success: false,
        retryable: true,
        normalizedError: 'TRANSIENT_API',
      }),
    );
  });

  it('rejects malformed asset identifiers', async () => {
    fetchMock.mockImplementation(async (input: URL) => input.pathname.endsWith('/adaccounts')
      ? json({ data: [{ id: 'attacker-controlled', name: 'Ads' }] })
      : json({ data: [] }));
    await expect(adapter.discoverAssets(credentialRef, tenantId)).resolves.toEqual(
      expect.objectContaining({ success: false, normalizedError: 'VALIDATION' }),
    );
  });

  it('does not call the network when Vault access fails', async () => {
    vault.getSecret.mockRejectedValueOnce(new Error('vault detail'));
    await expect(adapter.validateConnection(tenantId, credentialRef)).resolves.toEqual(
      expect.objectContaining({ success: false, normalizedError: 'AUTH_PERMISSION' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the network with invalid Meta configuration', async () => {
    (config.get as jest.Mock).mockImplementation((key: string) =>
      key === 'META_GRAPH_API_VERSION' ? 'latest' : values[key]);
    await expect(adapter.validateConnection(tenantId, credentialRef)).resolves.toEqual(
      expect.objectContaining({ success: false, normalizedError: 'AUTH_PERMISSION' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads only a validated ad account identifier', async () => {
    fetchMock.mockResolvedValueOnce(json({
      id: 'act_123',
      name: 'Primary ads',
      account_status: 1,
      currency: 'BRL',
      timezone_name: 'America/Sao_Paulo',
    }));
    await expect(adapter.readAdAccount(tenantId, credentialRef, 'act_123')).resolves
      .toEqual(expect.objectContaining({ success: true }));

    fetchMock.mockClear();
    await expect(adapter.readAdAccount(tenantId, credentialRef, '../me')).resolves
      .toEqual(expect.objectContaining({ success: false, normalizedError: 'VALIDATION' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates read capabilities from granted permissions and discovered assets', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { permission: 'ads_read', status: 'granted' },
      { permission: 'pages_show_list', status: 'granted' },
      { permission: 'ads_management', status: 'declined' },
    ] }));

    await expect(adapter.validateCapabilities(
      tenantId,
      credentialRef,
      [{
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        assetType: 'ad_account',
        externalId: 'act_123',
        selected: false,
        observedAt: '2026-08-24T01:00:00.000Z',
      }],
      ['DISCOVER_ASSETS', 'READ_AD_ACCOUNT'],
    )).resolves.toEqual(expect.objectContaining({
      success: true,
      data: [expect.objectContaining({
        capability: 'DISCOVER_ASSETS',
        available: true,
        grantedPermissions: ['ads_read', 'pages_show_list'],
        apiVersion: 'v26.0',
      }), expect.objectContaining({
        capability: 'READ_AD_ACCOUNT',
        available: true,
        assetScope: 'act_123',
        grantedPermissions: ['ads_read'],
      })],
    }));
    expect(vault.getSecret).toHaveBeenCalledWith(tenantId, credentialRef);
    const [input] = fetchMock.mock.calls[0] as [URL];
    expect(input.pathname).toBe('/v26.0/me/permissions');
    expect(input.toString()).not.toContain(accessToken);
  });

  it('reports missing permissions and assets without claiming availability', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { permission: 'ads_read', status: 'granted' },
      { permission: 'pages_show_list', status: 'declined' },
    ] }));

    await expect(adapter.validateCapabilities(
      tenantId,
      credentialRef,
      [],
      ['DISCOVER_ASSETS', 'READ_AD_ACCOUNT'],
    )).resolves.toEqual(expect.objectContaining({
      success: true,
      data: [expect.objectContaining({
        capability: 'DISCOVER_ASSETS',
        available: false,
        reason: 'permission_missing',
      }), expect.objectContaining({
        capability: 'READ_AD_ACCOUNT',
        available: false,
        reason: 'asset_missing',
      })],
    }));
  });

  it('validates execution capabilities using permission and selected asset evidence only', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { permission: 'ads_management', status: 'granted' },
    ] }));
    const bindings = [
      {
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        assetType: 'ad_account' as const,
        externalId: 'act_123',
        selected: true,
        observedAt: '2026-08-24T01:00:00.000Z',
      },
      {
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        assetType: 'facebook_page' as const,
        externalId: '456',
        selected: true,
        observedAt: '2026-08-24T01:00:00.000Z',
      },
      {
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        assetType: 'whatsapp' as const,
        externalId: '789',
        selected: true,
        observedAt: '2026-08-24T01:00:00.000Z',
      },
    ];

    const result = await adapter.validateCapabilities(
      tenantId,
      credentialRef,
      bindings,
      ['CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_CREATIVE', 'CREATE_AD',
        'CLICK_TO_WHATSAPP'],
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({ capability: 'CREATE_CAMPAIGN', available: true,
          assetScope: 'act_123', requiredPermissions: ['ads_management'] }),
        expect.objectContaining({ capability: 'CLICK_TO_WHATSAPP', available: true,
          assetScope: 'act_123', requiredPermissions: ['ads_management'] }),
      ]),
    }));
  });

  it('keeps Click-to-WhatsApp unavailable without selected page and WhatsApp assets', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { permission: 'ads_management', status: 'granted' },
    ] }));

    const result = await adapter.validateCapabilities(
      tenantId,
      credentialRef,
      [{
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        assetType: 'ad_account',
        externalId: 'act_123',
        selected: true,
        observedAt: '2026-08-24T01:00:00.000Z',
      }],
      ['CREATE_CAMPAIGN', 'CLICK_TO_WHATSAPP'],
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: [
        expect.objectContaining({ capability: 'CREATE_CAMPAIGN', available: true }),
        expect.objectContaining({ capability: 'CLICK_TO_WHATSAPP', available: false,
          reason: 'asset_missing' }),
      ],
    }));
  });

  it('fails closed on malformed permission evidence', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { permission: 'ads_read' },
    ] }));

    await expect(adapter.validateCapabilities(
      tenantId,
      credentialRef,
      [],
      ['DISCOVER_ASSETS'],
    )).resolves.toEqual(expect.objectContaining({
      success: false,
      normalizedError: 'VALIDATION',
    }));
  });

  it('rejects oversized declared responses', async () => {
    fetchMock.mockResolvedValueOnce(json(
      { id: '123' },
      200,
      { 'content-length': String((256 * 1024) + 1) },
    ));
    await expect(adapter.validateConnection(tenantId, credentialRef)).resolves.toEqual(
      expect.objectContaining({ success: false, normalizedError: 'VALIDATION' }),
    );
  });
});
