import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { MetaInsightsReadonlyAdapter } from './meta-insights-readonly.adapter';

describe('MetaInsightsReadonlyAdapter', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const credentialRef = 'postgres-vault://22222222-2222-4222-8222-222222222222';
  const accessToken = 'server-only-access-token';
  const appSecret = 'server-only-app-secret';
  const values: Record<string, string> = {
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
  let adapter: MetaInsightsReadonlyAdapter;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockImplementation((key: string) => values[key]);
    vault.getSecret.mockResolvedValue(JSON.stringify({
      version: 1,
      provider: 'meta',
      accessToken,
    }));
    adapter = new MetaInsightsReadonlyAdapter(config, vault, fetchMock as typeof fetch);
  });

  it('reads campaign identity then campaign-level insights using GET only', async () => {
    fetchMock
      .mockResolvedValueOnce(json({
        id: '123456',
        name: 'Rosa VIP Leads',
        account_id: '929361834160386',
        status: 'ACTIVE',
        effective_status: 'ACTIVE',
        created_time: '2026-08-20T12:00:00+0000',
      }))
      .mockResolvedValueOnce(json({ data: [{
        campaign_id: '123456',
        campaign_name: 'Rosa VIP Leads',
        impressions: '2500',
        reach: '1800',
        spend: '42.35',
        clicks: '93',
        frequency: '1.3889',
        ctr: '3.72',
        cpc: '0.4554',
        actions: [
          { action_type: 'link_click', value: '93' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '14' },
        ],
        date_start: '2026-08-30',
        date_stop: '2026-08-31',
      }] }));

    const result = await adapter.readCampaignInsights(
      tenantId,
      credentialRef,
      'act_929361834160386',
      '123456',
      '2026-08-30',
      '2026-08-31',
      'BRL',
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      retryable: false,
      data: expect.objectContaining({
        campaignId: '123456',
        adAccountId: 'act_929361834160386',
        status: 'ACTIVE',
        impressions: 2500,
        reach: 1800,
        spendMinor: 4235,
        clicks: 93,
        results: 14,
        resultActionType: 'onsite_conversion.messaging_conversation_started_7d',
        cpcMinor: 46,
        boundaries: {
          readonly: true,
          metaWritePerformed: false,
          externalWritesAllowed: false,
          credentialsExposed: false,
        },
      }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as Array<[URL, RequestInit]>) {
      expect(init.method).toBe('GET');
      expect(url.toString()).not.toContain(accessToken);
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${accessToken}`);
      expect(url.searchParams.get('appsecret_proof')).toBe(
        createHmac('sha256', appSecret).update(accessToken).digest('hex'),
      );
    }
    const insightsUrl = (fetchMock.mock.calls[1] as [URL])[0];
    expect(insightsUrl.pathname).toBe('/v26.0/123456/insights');
    expect(insightsUrl.searchParams.get('level')).toBe('campaign');
    expect(insightsUrl.searchParams.get('time_range')).toBe(
      JSON.stringify({ since: '2026-08-30', until: '2026-08-31' }),
    );
  });

  it('fails closed when campaign belongs to another ad account', async () => {
    fetchMock.mockResolvedValueOnce(json({
      id: '123456',
      account_id: '999999',
      status: 'ACTIVE',
    }));
    await expect(adapter.readCampaignInsights(
      tenantId,
      credentialRef,
      'act_929361834160386',
      '123456',
      '2026-08-30',
      '2026-08-31',
      'BRL',
    )).resolves.toEqual(expect.objectContaining({
      success: false,
      retryable: false,
      normalizedError: 'VALIDATION',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed ids and oversized date windows without network access', async () => {
    await expect(adapter.readCampaignInsights(
      tenantId,
      credentialRef,
      'act_929361834160386',
      '../campaign',
      '2026-01-01',
      '2026-08-31',
      'BRL',
    )).resolves.toEqual(expect.objectContaining({
      success: false,
      normalizedError: 'VALIDATION',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vault.getSecret).not.toHaveBeenCalled();
  });

  it('returns a zero snapshot when Meta has no delivery in the requested period', async () => {
    fetchMock
      .mockResolvedValueOnce(json({
        id: '123456',
        account_id: '929361834160386',
        status: 'ACTIVE',
      }))
      .mockResolvedValueOnce(json({ data: [] }));
    const result = await adapter.readCampaignInsights(
      tenantId,
      credentialRef,
      'act_929361834160386',
      '123456',
      '2026-08-31',
      '2026-08-31',
      'BRL',
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        impressions: 0,
        reach: 0,
        spendMinor: 0,
        clicks: 0,
        results: 0,
        resultActionType: null,
      }),
    }));
  });

  it('classifies permission errors and never exposes raw Meta errors', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 190, message: 'secret raw detail' } }, 401));
    await expect(adapter.readCampaignInsights(
      tenantId,
      credentialRef,
      'act_929361834160386',
      '123456',
      '2026-08-31',
      '2026-08-31',
      'BRL',
    )).resolves.toEqual(expect.objectContaining({
      success: false,
      retryable: false,
      normalizedError: 'AUTH_PERMISSION',
    }));
  });
});
