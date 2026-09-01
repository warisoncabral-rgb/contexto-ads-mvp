import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { MetaAdapterResult } from '../../domain/ports/meta-adapter.port';
import {
  MetaWriteAdapterPort,
  MetaWriteObjectResult,
} from '../../domain/ports/meta-write-adapter.port';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';

const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_LIMIT_BYTES = 256 * 1024;
type NormalizedError = NonNullable<MetaAdapterResult<unknown>['normalizedError']>;

class MetaWriteRequestError extends Error {
  constructor(
    readonly normalizedError: NormalizedError,
    readonly retryable: boolean,
    readonly diagnosticCode?: string,
  ) {
    super('Meta Graph write request failed');
  }
}

export class MetaWriteAdapter implements MetaWriteAdapterPort {
  constructor(
    private readonly config: ConfigService,
    private readonly vault: CredentialVaultPort,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  enabled(): boolean {
    const explicit = this.config.get<string>('META_WRITE_ADAPTER_ENABLED')?.trim();
    if (explicit === 'true') return true;
    return this.config.get<string>('NODE_ENV')?.trim() === 'production'
      && this.config.get<string>('BOOTSTRAP_TENANT_ID')?.trim()
        === '22222222-2222-4222-8222-222222222222'
      && this.config.get<string>('OPERATOR_BOOTSTRAP_SUBJECT')?.trim()
        === 'operator:warison';
  }

  async create(
    tenantId: string,
    credentialRef: string,
    edgePath: string,
    params: Record<string, string | number | boolean | object | unknown[]>,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !/^\/(?:act_\d+)\/(?:campaigns|adsets|adcreatives|ads|advideos)$/.test(edgePath)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('POST', edgePath, params, accessToken);
      if (!this.isObject(payload) || !this.isDigits(payload.id)) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({ id: payload.id }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async updateStatus(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !this.isDigits(externalObjectId)
      || !['ACTIVE', 'PAUSED'].includes(status)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('POST', `/${externalObjectId}`, { status }, accessToken);
      if (!this.isObject(payload) || payload.success !== true) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      const observed = await this.request('GET', `/${externalObjectId}`, {
        fields: 'id,status,effective_status',
      }, accessToken);
      if (!this.isObject(observed) || observed.id !== externalObjectId) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({
        id: externalObjectId,
        ...(typeof observed.status === 'string' ? { configuredStatus: observed.status } : {}),
        ...(typeof observed.effective_status === 'string'
          ? { effectiveStatus: observed.effective_status } : {}),
      }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async read(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
    lifecycleObject = true,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !this.isDigits(externalObjectId)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('GET', `/${externalObjectId}`, {
        fields: lifecycleObject ? 'id,status,effective_status' : 'id',
      }, accessToken);
      if (!this.isObject(payload) || payload.id !== externalObjectId) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({
        id: payload.id,
        ...(typeof payload.status === 'string'
          ? { configuredStatus: payload.status } : {}),
        ...(typeof payload.effective_status === 'string'
          ? { effectiveStatus: payload.effective_status } : {}),
      }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async searchCity(
    tenantId: string,
    credentialRef: string,
    city: string,
    countryCode: string,
  ): Promise<MetaAdapterResult<{ key: string; name: string }>> {
    const observedAt = new Date().toISOString();
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('GET', '/search', {
        type: 'adgeolocation',
        location_types: ['city'],
        q: city,
        country_code: countryCode,
        limit: 10,
      }, accessToken);
      if (!this.isObject(payload) || !Array.isArray(payload.data)) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      const normalized = this.normalize(city);
      const result = payload.data.find((item) => this.isObject(item)
        && typeof item.key === 'string' && typeof item.name === 'string'
        && this.normalize(item.name) === normalized);
      if (!this.isObject(result) || typeof result.key !== 'string'
        || typeof result.name !== 'string') {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({ key: result.key, name: result.name }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async createVideo(
    tenantId: string,
    credentialRef: string,
    adAccountId: string,
    fileUrl: string,
    title: string,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !/^act_\d+$/.test(adAccountId)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== 'https:') throw new MetaWriteRequestError('VALIDATION', false);
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('POST', `/${adAccountId}/advideos`, {
        file_url: url.toString(),
        title,
      }, accessToken);
      if (!this.isObject(payload) || !this.isDigits(payload.id)) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({ id: payload.id }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async readVideoStatus(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
  ): Promise<MetaAdapterResult<{ id: string; videoStatus: string }>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !this.isDigits(externalObjectId)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('GET', `/${externalObjectId}`, {
        fields: 'id,status',
      }, accessToken);
      const status = this.isObject(payload) && this.isObject(payload.status)
        ? payload.status.video_status : undefined;
      if (!this.isObject(payload) || payload.id !== externalObjectId
        || typeof status !== 'string') {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      return this.success({ id: externalObjectId, videoStatus: status }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  async readVideoThumbnail(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
  ): Promise<MetaAdapterResult<{ imageUrl: string }>> {
    const observedAt = new Date().toISOString();
    if (!this.enabled() || !this.isDigits(externalObjectId)) {
      return this.failure(new MetaWriteRequestError('VALIDATION', false), observedAt);
    }
    try {
      const accessToken = await this.accessToken(tenantId, credentialRef);
      const payload = await this.request('GET', `/${externalObjectId}/thumbnails`, {
        fields: 'uri,is_preferred',
        limit: 10,
      }, accessToken);
      if (!this.isObject(payload) || !Array.isArray(payload.data)) {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      const candidates = payload.data.filter((item) => this.isObject(item)
        && typeof item.uri === 'string' && /^https:\/\//.test(item.uri));
      const selected = candidates.find((item) => item.is_preferred === true) ?? candidates[0];
      if (!this.isObject(selected) || typeof selected.uri !== 'string') {
        throw new MetaWriteRequestError('MEDIA', false);
      }
      return this.success({ imageUrl: selected.uri }, observedAt);
    } catch (error) {
      return this.failure(error, observedAt);
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | boolean | object | unknown[]>,
    accessToken: string,
  ): Promise<unknown> {
    const origin = this.config.get<string>('META_GRAPH_BASE_URL')?.trim()
      || 'https://graph.facebook.com';
    const version = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    const secret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    if (!/^v\d+\.\d+$/.test(version) || !secret) {
      throw new MetaWriteRequestError('VALIDATION', false);
    }
    const url = new URL(`/${version}${path}`, origin);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const encoded = typeof value === 'string' ? value : JSON.stringify(value);
      (method === 'GET' ? url.searchParams : body).set(key, encoded);
    }
    const proof = createHmac('sha256', secret).update(accessToken).digest('hex');
    (method === 'GET' ? url.searchParams : body).set('appsecret_proof', proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(method === 'POST'
            ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(method === 'POST' ? { body } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new MetaWriteRequestError('UNKNOWN', false);
      }
      const raw = await this.readBoundedBody(response, controller);
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch {
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      if (!response.ok) throw this.classify(response.status, payload);
      return payload;
    } catch (error) {
      if (error instanceof MetaWriteRequestError) throw error;
      throw new MetaWriteRequestError('TRANSIENT_API', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async accessToken(tenantId: string, credentialRef: string): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(await this.vault.getSecret(tenantId, credentialRef));
      if (!this.isObject(parsed) || parsed.version !== 1 || parsed.provider !== 'meta'
        || typeof parsed.accessToken !== 'string' || !parsed.accessToken) throw new Error();
      return parsed.accessToken;
    } catch {
      throw new MetaWriteRequestError('AUTH_PERMISSION', false);
    }
  }

  private classify(status: number, payload: unknown): MetaWriteRequestError {
    const code = this.isObject(payload) && this.isObject(payload.error)
      && typeof payload.error.code === 'number' ? payload.error.code : 0;
    const subcode = this.isObject(payload) && this.isObject(payload.error)
      && typeof payload.error.error_subcode === 'number' ? payload.error.error_subcode : 0;
    const diagnosticCode = code > 0
      ? `META_${code}${subcode > 0 ? `_${subcode}` : ''}`
      : `HTTP_${status}`;
    if ([190, 10, 200, 294].includes(code) || status === 401 || status === 403) {
      return new MetaWriteRequestError('AUTH_PERMISSION', false, diagnosticCode);
    }
    if (code === 100 || status === 400 || status === 422) {
      return new MetaWriteRequestError('VALIDATION', false, diagnosticCode);
    }
    if (code === 17 || code === 4 || status === 429 || status >= 500) {
      return new MetaWriteRequestError('TRANSIENT_API', true, diagnosticCode);
    }
    return new MetaWriteRequestError('UNKNOWN', false, diagnosticCode);
  }

  private async readBoundedBody(response: Response, controller: AbortController) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT_BYTES) {
        controller.abort();
        throw new MetaWriteRequestError('VALIDATION', false);
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(joined);
  }

  private success<T>(data: T, observedAt: string): MetaAdapterResult<T> {
    return { success: true, data, observedAt, retryable: false };
  }

  private failure<T>(error: unknown, observedAt: string): MetaAdapterResult<T> {
    const normalized = error instanceof MetaWriteRequestError
      ? error : new MetaWriteRequestError('UNKNOWN', false);
    return {
      success: false,
      observedAt,
      retryable: normalized.retryable,
      normalizedError: normalized.normalizedError,
      ...(normalized.diagnosticCode ? { diagnosticCode: normalized.diagnosticCode } : {}),
    };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private isDigits(value: unknown): value is string {
    return typeof value === 'string' && /^\d{5,40}$/.test(value);
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
