import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { MetaCampaignInsightsV1, MetaInsightActionV1 } from '../../domain/contracts/meta-insights';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { MetaAdapterResult } from '../../domain/ports/meta-adapter.port';
import { MetaInsightsReadonlyPort } from '../../domain/ports/meta-insights-readonly.port';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 8_000;
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const MAX_INSIGHT_DAYS = 31;
const RESULT_ACTION_PRIORITY = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
  'lead',
  'offsite_conversion.fb_pixel_lead',
] as const;
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

type NormalizedError = NonNullable<MetaAdapterResult<unknown>['normalizedError']>;

class MetaInsightsRequestError extends Error {
  constructor(
    readonly normalizedError: NormalizedError,
    readonly retryable: boolean,
  ) {
    super('Meta Insights request failed');
  }
}

interface CampaignPayload {
  id: string;
  name?: string;
  account_id: string;
  status: string;
  effective_status?: string;
  created_time?: string;
  updated_time?: string;
}

export class MetaInsightsReadonlyAdapter implements MetaInsightsReadonlyPort {
  constructor(
    private readonly config: ConfigService,
    private readonly vault: CredentialVaultPort,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async readCampaignInsights(
    tenantId: string,
    credentialRef: string,
    expectedAdAccountId: string,
    campaignId: string,
    periodStart: string,
    periodEnd: string,
    currency: string,
  ): Promise<MetaAdapterResult<MetaCampaignInsightsV1>> {
    const observedAt = new Date().toISOString();
    try {
      this.validateInput(expectedAdAccountId, campaignId, periodStart, periodEnd, currency);
      const credential = await this.getCredential(tenantId, credentialRef);
      const campaign = this.parseCampaign(await this.graphGet(
        `/${campaignId}`,
        { fields: 'id,name,account_id,status,effective_status,created_time,updated_time' },
        credential.accessToken,
      ));
      const normalizedAccountId = campaign.account_id.startsWith('act_')
        ? campaign.account_id
        : `act_${campaign.account_id}`;
      if (campaign.id !== campaignId || normalizedAccountId !== expectedAdAccountId) {
        throw new MetaInsightsRequestError('VALIDATION', false);
      }

      const payload = await this.graphGet(
        `/${campaignId}/insights`,
        {
          fields: 'campaign_id,campaign_name,impressions,reach,spend,clicks,frequency,ctr,cpc,actions,date_start,date_stop',
          level: 'campaign',
          limit: '1',
          time_range: JSON.stringify({ since: periodStart, until: periodEnd }),
        },
        credential.accessToken,
      );
      const insight = this.firstInsight(payload);
      const metrics = insight
        ? this.parseInsight(insight, campaignId, currency)
        : {
          impressions: 0,
          reach: 0,
          spendMinor: 0,
          clicks: 0,
          actions: [] as MetaInsightActionV1[],
          results: 0,
          resultActionType: null,
        };

      return {
        success: true,
        observedAt,
        retryable: false,
        data: {
          campaignId,
          ...(campaign.name ? { campaignName: campaign.name } : {}),
          adAccountId: expectedAdAccountId,
          status: campaign.status,
          ...(campaign.effective_status ? { effectiveStatus: campaign.effective_status } : {}),
          ...(campaign.created_time ? { createdTime: campaign.created_time } : {}),
          ...(campaign.updated_time ? { updatedTime: campaign.updated_time } : {}),
          periodStart,
          periodEnd,
          currency,
          ...metrics,
          observedAt,
          boundaries: {
            readonly: true,
            metaWritePerformed: false,
            externalWritesAllowed: false,
            credentialsExposed: false,
          },
        },
      };
    } catch (error) {
      const normalized = error instanceof MetaInsightsRequestError
        ? error
        : new MetaInsightsRequestError('UNKNOWN', false);
      return {
        success: false,
        observedAt,
        retryable: normalized.retryable,
        normalizedError: normalized.normalizedError,
      };
    }
  }

  private validateInput(
    expectedAdAccountId: string,
    campaignId: string,
    periodStart: string,
    periodEnd: string,
    currency: string,
  ) {
    if (!/^act_\d+$/.test(expectedAdAccountId) || !/^\d+$/.test(campaignId)) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)
      || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      || !/^[A-Z]{3}$/.test(currency)) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    const start = Date.parse(`${periodStart}T00:00:00Z`);
    const end = Date.parse(`${periodEnd}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    const days = Math.floor((end - start) / 86_400_000) + 1;
    if (days < 1 || days > MAX_INSIGHT_DAYS) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
  }

  private parseCampaign(value: unknown): CampaignPayload {
    if (!this.isObject(value)
      || !this.isDigits(value.id)
      || !(this.isDigits(value.account_id) || /^act_\d+$/.test(String(value.account_id)))
      || typeof value.status !== 'string'
      || !value.status.trim()) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    if (value.name !== undefined && typeof value.name !== 'string') {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    for (const field of ['effective_status', 'created_time', 'updated_time'] as const) {
      if (value[field] !== undefined && typeof value[field] !== 'string') {
        throw new MetaInsightsRequestError('VALIDATION', false);
      }
    }
    return value as CampaignPayload;
  }

  private firstInsight(value: unknown): Record<string, unknown> | null {
    if (!this.isObject(value) || !Array.isArray(value.data) || value.data.length > 1) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    if (value.data.length === 0) return null;
    const insight = value.data[0];
    if (!this.isObject(insight)) throw new MetaInsightsRequestError('VALIDATION', false);
    return insight;
  }

  private parseInsight(
    insight: Record<string, unknown>,
    campaignId: string,
    currency: string,
  ) {
    if (String(insight.campaign_id ?? campaignId) !== campaignId) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    const impressions = this.nonNegativeNumber(insight.impressions ?? '0');
    const reach = this.nonNegativeNumber(insight.reach ?? '0');
    const spend = this.nonNegativeNumber(insight.spend ?? '0');
    const clicks = this.nonNegativeNumber(insight.clicks ?? '0');
    const frequency = insight.frequency === undefined
      ? undefined
      : this.nonNegativeNumber(insight.frequency);
    const ctr = insight.ctr === undefined ? undefined : this.nonNegativeNumber(insight.ctr);
    const cpc = insight.cpc === undefined ? undefined : this.nonNegativeNumber(insight.cpc);
    const actions = this.parseActions(insight.actions);
    const result = this.selectResult(actions);
    return {
      impressions: Math.round(impressions),
      reach: Math.round(reach),
      spendMinor: this.toMinor(spend, currency),
      clicks: Math.round(clicks),
      ...(frequency === undefined ? {} : { frequency }),
      ...(ctr === undefined ? {} : { ctr }),
      ...(cpc === undefined ? {} : { cpcMinor: this.toMinor(cpc, currency) }),
      actions,
      results: result.value,
      resultActionType: result.actionType,
    };
  }

  private parseActions(value: unknown): MetaInsightActionV1[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    return value.map((item) => {
      if (!this.isObject(item)
        || typeof item.action_type !== 'string'
        || !item.action_type.trim()
        || item.action_type.length > 128) {
        throw new MetaInsightsRequestError('VALIDATION', false);
      }
      return {
        actionType: item.action_type,
        value: this.nonNegativeNumber(item.value ?? '0'),
      };
    });
  }

  private selectResult(actions: MetaInsightActionV1[]) {
    for (const actionType of RESULT_ACTION_PRIORITY) {
      const match = actions.find((action) => action.actionType === actionType);
      if (match) return { actionType, value: match.value };
    }
    return { actionType: null, value: 0 };
  }

  private toMinor(value: number, currency: string): number {
    const factor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
    return Math.round(value * factor);
  }

  private nonNegativeNumber(value: unknown): number {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    return parsed;
  }

  private async graphGet(
    path: string,
    query: Record<string, string>,
    accessToken: string,
  ): Promise<unknown> {
    const { apiVersion, appSecret } = this.getConfiguration();
    const url = new URL(`/${apiVersion}${path}`, META_GRAPH_ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set(
      'appsecret_proof',
      createHmac('sha256', appSecret).update(accessToken).digest('hex'),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new MetaInsightsRequestError('UNKNOWN', false);
      }
      const raw = await this.readBoundedBody(response, controller);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new MetaInsightsRequestError('VALIDATION', false);
      }
      if (!response.ok) throw this.classifyResponse(response.status, payload);
      return payload;
    } catch (error) {
      if (error instanceof MetaInsightsRequestError) throw error;
      throw new MetaInsightsRequestError('TRANSIENT_API', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getCredential(tenantId: string, credentialRef: string) {
    let raw: string;
    try {
      raw = await this.vault.getSecret(tenantId, credentialRef);
    } catch {
      throw new MetaInsightsRequestError('AUTH_PERMISSION', false);
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (!this.isObject(value)
        || value.version !== 1
        || value.provider !== 'meta'
        || typeof value.accessToken !== 'string'
        || value.accessToken.length < 1
        || value.accessToken.length > 16_384) {
        throw new Error('invalid');
      }
      return { accessToken: value.accessToken };
    } catch {
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
  }

  private getConfiguration() {
    const appSecret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    const apiVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    if (!appSecret || !/^v\d+\.\d+$/.test(apiVersion)) {
      throw new MetaInsightsRequestError('AUTH_PERMISSION', false);
    }
    return { appSecret, apiVersion };
  }

  private classifyResponse(status: number, payload: unknown): MetaInsightsRequestError {
    const code = this.isObject(payload) && this.isObject(payload.error)
      ? payload.error.code
      : undefined;
    if (status === 429 || status >= 500 || [1, 2, 4, 17, 32, 613].includes(Number(code))) {
      return new MetaInsightsRequestError('TRANSIENT_API', true);
    }
    if (status === 401 || status === 403 || [10, 190, 200].includes(Number(code))) {
      return new MetaInsightsRequestError('AUTH_PERMISSION', false);
    }
    return new MetaInsightsRequestError('UNKNOWN', false);
  }

  private async readBoundedBody(response: Response, controller: AbortController) {
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > RESPONSE_LIMIT_BYTES) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      throw new MetaInsightsRequestError('VALIDATION', false);
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT_BYTES) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          throw new MetaInsightsRequestError('VALIDATION', false);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size).toString('utf8');
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isDigits(value: unknown): value is string {
    return typeof value === 'string' && /^\d+$/.test(value);
  }
}
