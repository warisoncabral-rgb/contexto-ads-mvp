import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { MetaCapabilityType } from '../../domain/contracts/capability';
import { MetaAssetBinding } from '../../domain/contracts/meta-connection';
import {
  DiscoveredMetaAsset,
  MetaAdapterPort,
  MetaAdapterResult,
} from '../../domain/ports/meta-adapter.port';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 5_000;
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const MAX_PAGES = 10;
type NormalizedError = NonNullable<MetaAdapterResult<unknown>['normalizedError']>;

class MetaGraphRequestError extends Error {
  constructor(
    readonly normalizedError: NormalizedError,
    readonly retryable: boolean,
  ) {
    super('Meta Graph request failed');
  }
}

interface GraphPage {
  data: unknown[];
  paging?: { cursors?: { after?: string } };
}

export class MetaReadonlyAdapter implements MetaAdapterPort {
  constructor(
    private readonly config: ConfigService,
    private readonly vault: CredentialVaultPort,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async validateConnection(tenantId: string, credentialRef: string) {
    const observedAt = new Date().toISOString();
    try {
      const credential = await this.getCredential(tenantId, credentialRef);
      const payload = await this.graphGet('/me', { fields: 'id' }, credential.accessToken);
      if (!this.isObject(payload) || !this.isDigits(payload.id)) {
        throw new MetaGraphRequestError('VALIDATION', false);
      }
      return this.success({ subjectId: payload.id }, observedAt);
    } catch (error) {
      return this.failure<{ subjectId: string }>(error, observedAt);
    }
  }

  async discoverAssets(credentialRef: string, tenantId: string) {
    const observedAt = new Date().toISOString();
    try {
      const credential = await this.getCredential(tenantId, credentialRef);
      const [adAccounts, pages] = await Promise.all([
        this.collectEdge('/me/adaccounts', credential.accessToken),
        this.collectEdge('/me/accounts', credential.accessToken),
      ]);
      const assets: DiscoveredMetaAsset[] = [
        ...adAccounts.map((item) => this.toAsset(item, 'ad_account')),
        ...pages.map((item) => this.toAsset(item, 'facebook_page')),
      ];
      return this.success(assets, observedAt);
    } catch (error) {
      return this.failure<DiscoveredMetaAsset[]>(error, observedAt);
    }
  }

  async validateCapabilities(
    _credentialRef: string,
    _assetBindings: MetaAssetBinding[],
    _requested: MetaCapabilityType[],
  ) {
    return this.notConfigured<Array<{
      capability: MetaCapabilityType;
      available: boolean;
      reason?: string;
    }>>();
  }

  async readAdAccount(tenantId: string, credentialRef: string, adAccountId: string) {
    const observedAt = new Date().toISOString();
    if (!/^act_\d+$/.test(adAccountId)) {
      return this.failure<Record<string, unknown>>(
        new MetaGraphRequestError('VALIDATION', false),
        observedAt,
      );
    }
    try {
      const credential = await this.getCredential(tenantId, credentialRef);
      const payload = await this.graphGet(
        `/${adAccountId}`,
        { fields: 'id,name,account_status,currency,timezone_name' },
        credential.accessToken,
      );
      if (!this.isObject(payload) || payload.id !== adAccountId) {
        throw new MetaGraphRequestError('VALIDATION', false);
      }
      return this.success(payload, observedAt);
    } catch (error) {
      return this.failure<Record<string, unknown>>(error, observedAt);
    }
  }

  private async collectEdge(path: string, accessToken: string): Promise<unknown[]> {
    const items: unknown[] = [];
    const seenCursors = new Set<string>();
    let after: string | undefined;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const payload = await this.graphGet(
        path,
        { fields: 'id,name', limit: '100', ...(after ? { after } : {}) },
        accessToken,
      );
      if (!this.isGraphPage(payload)) throw new MetaGraphRequestError('VALIDATION', false);
      items.push(...payload.data);
      const nextCursor = payload.paging?.cursors?.after;
      if (!nextCursor) return items;
      if (seenCursors.has(nextCursor)) {
        throw new MetaGraphRequestError('VALIDATION', false);
      }
      seenCursors.add(nextCursor);
      after = nextCursor;
    }
    throw new MetaGraphRequestError('TRANSIENT_API', true);
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
        throw new MetaGraphRequestError('UNKNOWN', false);
      }
      const raw = await this.readBoundedBody(response, controller);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new MetaGraphRequestError('VALIDATION', false);
      }
      if (!response.ok) throw this.classifyResponse(response.status, payload);
      return payload;
    } catch (error) {
      if (error instanceof MetaGraphRequestError) throw error;
      throw new MetaGraphRequestError('TRANSIENT_API', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getCredential(tenantId: string, credentialRef: string) {
    let raw: string;
    try {
      raw = await this.vault.getSecret(tenantId, credentialRef);
    } catch {
      throw new MetaGraphRequestError('AUTH_PERMISSION', false);
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (
        !this.isObject(value) || value.version !== 1 || value.provider !== 'meta' ||
        typeof value.accessToken !== 'string' || value.accessToken.length === 0 ||
        value.accessToken.length > 16_384
      ) {
        throw new Error('invalid');
      }
      return { accessToken: value.accessToken };
    } catch {
      throw new MetaGraphRequestError('VALIDATION', false);
    }
  }

  private getConfiguration() {
    const appId = this.config.get<string>('META_APP_ID')?.trim() ?? '';
    const appSecret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    const apiVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    if (!/^\d+$/.test(appId) || !appSecret || !/^v\d+\.\d+$/.test(apiVersion)) {
      throw new MetaGraphRequestError('AUTH_PERMISSION', false);
    }
    return { appSecret, apiVersion };
  }

  private classifyResponse(status: number, payload: unknown): MetaGraphRequestError {
    const code = this.isObject(payload) && this.isObject(payload.error)
      ? payload.error.code
      : undefined;
    if (status === 429 || status >= 500 || [1, 2, 4, 17, 32, 613].includes(Number(code))) {
      return new MetaGraphRequestError('TRANSIENT_API', true);
    }
    if (status === 401 || status === 403 || [10, 190, 200].includes(Number(code))) {
      return new MetaGraphRequestError('AUTH_PERMISSION', false);
    }
    return new MetaGraphRequestError('UNKNOWN', false);
  }

  private async readBoundedBody(response: Response, controller: AbortController) {
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > RESPONSE_LIMIT_BYTES) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      throw new MetaGraphRequestError('VALIDATION', false);
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
          throw new MetaGraphRequestError('VALIDATION', false);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size).toString('utf8');
  }

  private toAsset(value: unknown, assetType: 'ad_account' | 'facebook_page') {
    if (!this.isObject(value) || typeof value.id !== 'string') {
      throw new MetaGraphRequestError('VALIDATION', false);
    }
    const validId = assetType === 'ad_account' ? /^act_\d+$/.test(value.id) : this.isDigits(value.id);
    if (!validId || (value.name !== undefined && typeof value.name !== 'string')) {
      throw new MetaGraphRequestError('VALIDATION', false);
    }
    return {
      assetType,
      externalId: value.id,
      ...(typeof value.name === 'string' ? { displayName: value.name.slice(0, 255) } : {}),
    } as const;
  }

  private isGraphPage(value: unknown): value is GraphPage {
    return this.isObject(value) && Array.isArray(value.data);
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isDigits(value: unknown): value is string {
    return typeof value === 'string' && /^\d+$/.test(value);
  }

  private success<T>(data: T, observedAt: string): MetaAdapterResult<T> {
    return { success: true, data, observedAt, retryable: false };
  }

  private failure<T>(error: unknown, observedAt: string): MetaAdapterResult<T> {
    const normalized = error instanceof MetaGraphRequestError
      ? error
      : new MetaGraphRequestError('UNKNOWN', false);
    return {
      success: false,
      observedAt,
      retryable: normalized.retryable,
      normalizedError: normalized.normalizedError,
    };
  }

  private notConfigured<T>(): MetaAdapterResult<T> {
    return {
      success: false,
      observedAt: new Date().toISOString(),
      retryable: false,
      normalizedError: 'AUTH_PERMISSION',
    };
  }
}
