import { ConfigService } from '@nestjs/config';
import {
  MetaOAuthExchangeError,
  MetaOAuthToken,
  MetaOAuthTokenExchangePort,
} from '../../domain/ports/meta-oauth-token-exchange.port';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const RESPONSE_LIMIT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export class MetaOAuthHttpAdapter implements MetaOAuthTokenExchangePort {
  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangeCode(code: string): Promise<MetaOAuthToken> {
    const oauth = this.getConfiguration();
    const endpoint = new URL(`/${oauth.apiVersion}/oauth/access_token`, META_GRAPH_ORIGIN);
    const body = new URLSearchParams({
      client_id: oauth.appId,
      client_secret: oauth.appSecret,
      redirect_uri: oauth.redirectUri,
      code,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > RESPONSE_LIMIT_BYTES) {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > RESPONSE_LIMIT_BYTES) {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    if (!response.ok || !this.isTokenPayload(payload)) {
      throw new MetaOAuthExchangeError('upstream', 'Meta token exchange failed');
    }

    return {
      accessToken: payload.access_token,
      ...(typeof payload.token_type === 'string' ? { tokenType: payload.token_type } : {}),
      ...(typeof payload.expires_in === 'number' ? { expiresIn: payload.expires_in } : {}),
    };
  }

  private getConfiguration(): {
    appId: string;
    appSecret: string;
    redirectUri: string;
    apiVersion: string;
  } {
    const appId = this.config.get<string>('META_APP_ID')?.trim() ?? '';
    const appSecret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI')?.trim() ?? '';
    const apiVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim() ?? 'development';

    if (!/^\d+$/.test(appId) || !appSecret || !/^v\d+\.\d+$/.test(apiVersion)) {
      throw new MetaOAuthExchangeError('configuration', 'Meta OAuth is not configured');
    }

    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      throw new MetaOAuthExchangeError('configuration', 'Meta OAuth is not configured');
    }

    const localDevelopment =
      nodeEnv === 'development' &&
      parsedRedirect.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(parsedRedirect.hostname);
    const validRedirect =
      (parsedRedirect.protocol === 'https:' || localDevelopment) &&
      !parsedRedirect.username &&
      !parsedRedirect.password &&
      !parsedRedirect.hash;
    if (!validRedirect) {
      throw new MetaOAuthExchangeError('configuration', 'Meta OAuth is not configured');
    }

    return {
      appId,
      appSecret,
      redirectUri: parsedRedirect.toString(),
      apiVersion,
    };
  }

  private isTokenPayload(payload: unknown): payload is {
    access_token: string;
    token_type?: string;
    expires_in?: number;
  } {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { access_token?: unknown }).access_token === 'string' &&
      (payload as { access_token: string }).access_token.length > 0,
    );
  }
}
