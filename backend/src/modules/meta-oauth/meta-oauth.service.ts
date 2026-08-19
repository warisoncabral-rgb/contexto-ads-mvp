import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { MetaOAuthAttempt } from '../../domain/contracts/meta-oauth-attempt';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import {
  MetaOAuthExchangeError,
  MetaOAuthTokenExchangePort,
} from '../../domain/ports/meta-oauth-token-exchange.port';
import { MetaOAuthAttemptStore } from '../../domain/ports/repositories';
import {
  META_CONNECTION_REPOSITORY,
  META_OAUTH_ATTEMPT_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { MetaConnectionStore } from '../../domain/ports/repositories';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { CREDENTIAL_VAULT, META_OAUTH_TOKEN_EXCHANGE } from './meta-oauth.tokens';

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const META_OAUTH_SCOPES = ['public_profile'] as const;
const META_AUTHORIZATION_ORIGIN = 'https://www.facebook.com';

export interface MetaOAuthCallbackInput {
  state?: unknown;
  code?: unknown;
  error?: unknown;
}

@Injectable()
export class MetaOAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: MetaConnectionService,
    @Inject(META_OAUTH_ATTEMPT_REPOSITORY)
    private readonly attempts: MetaOAuthAttemptStore,
    @Inject(META_OAUTH_TOKEN_EXCHANGE)
    private readonly tokenExchange: MetaOAuthTokenExchangePort,
    @Inject(CREDENTIAL_VAULT)
    private readonly vault: CredentialVaultPort,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connectionStore: MetaConnectionStore,
  ) {}

  async start(tenantId: string, connectionId: string) {
    const connection = await this.connections.getConnection(tenantId, connectionId);
    if (connection.status !== 'authorization_pending') {
      throw new ConflictException('Meta connection is not awaiting authorization');
    }

    const oauth = this.getValidatedConfiguration();
    const state = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_ATTEMPT_TTL_MS);
    const attempt: MetaOAuthAttempt = {
      attemptId: randomUUID(),
      tenantId: connection.tenantId,
      connectionId: connection.connectionId,
      stateHash: createHash('sha256').update(state).digest('hex'),
      requestedScopes: [...META_OAUTH_SCOPES],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.attempts.replaceActive(attempt);

    const authorizationUrl = new URL(
      `/${oauth.apiVersion}/dialog/oauth`,
      META_AUTHORIZATION_ORIGIN,
    );
    authorizationUrl.searchParams.set('client_id', oauth.appId);
    authorizationUrl.searchParams.set('redirect_uri', oauth.redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('scope', META_OAUTH_SCOPES.join(','));

    return {
      attemptId: attempt.attemptId,
      connectionId: attempt.connectionId,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: attempt.expiresAt,
      externalCallPerformed: false,
    };
  }

  async callback(input: MetaOAuthCallbackInput) {
    const state = this.requiredState(input.state);
    const code = typeof input.code === 'string' ? input.code : undefined;
    const providerError = typeof input.error === 'string' ? input.error : undefined;
    if ((!code && !providerError) || (code && providerError) || (code && code.length > 2048)) {
      throw new BadRequestException('Invalid Meta OAuth callback');
    }

    if (code && !(await this.isVaultAvailable())) {
      throw new ServiceUnavailableException('Credential Vault is not configured');
    }

    const stateHash = createHash('sha256').update(state).digest('hex');
    const attempt = await this.attempts.consumeActive(stateHash);
    if (!attempt) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    if (providerError) {
      throw new BadRequestException('Meta authorization was not completed');
    }

    const token = await this.exchangeCode(code!);
    const obtainedAt = new Date();
    const secret = JSON.stringify({
      version: 1,
      provider: 'meta',
      accessToken: token.accessToken,
      ...(token.tokenType ? { tokenType: token.tokenType } : {}),
      obtainedAt: obtainedAt.toISOString(),
      ...(typeof token.expiresIn === 'number'
        ? { expiresAt: new Date(obtainedAt.getTime() + token.expiresIn * 1000).toISOString() }
        : {}),
    });

    let credentialRef: string;
    try {
      credentialRef = await this.vault.putSecret(attempt.tenantId, secret);
    } catch {
      throw new ServiceUnavailableException('Credential Vault is unavailable');
    }

    let connected = false;
    try {
      connected = await this.connectionStore.markConnected(
        attempt.tenantId,
        attempt.connectionId,
        credentialRef,
        obtainedAt.toISOString(),
      );
    } catch {
      await this.compensateCredential(attempt.tenantId, credentialRef);
      throw new ServiceUnavailableException('Meta connection could not be finalized');
    }

    if (!connected) {
      await this.compensateCredential(attempt.tenantId, credentialRef);
      throw new ServiceUnavailableException('Meta connection could not be finalized');
    }

    return {
      status: 'connected' as const,
      connectionId: attempt.connectionId,
    };
  }

  private async isVaultAvailable(): Promise<boolean> {
    try {
      return await this.vault.isAvailable();
    } catch {
      return false;
    }
  }

  private requiredState(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    return value;
  }

  private async exchangeCode(code: string) {
    try {
      return await this.tokenExchange.exchangeCode(code);
    } catch (error) {
      if (error instanceof MetaOAuthExchangeError && error.kind === 'configuration') {
        throw new ServiceUnavailableException('Meta OAuth is not configured');
      }
      throw new BadGatewayException('Meta authorization could not be completed');
    }
  }

  private async compensateCredential(tenantId: string, credentialRef: string): Promise<void> {
    try {
      await this.vault.revokeSecret(tenantId, credentialRef);
    } catch {
      // Best-effort compensation. Never expose or persist the secret outside the Vault.
    }
  }

  private getValidatedConfiguration(): {
    appId: string;
    redirectUri: string;
    apiVersion: string;
  } {
    const appId = this.config.get<string>('META_APP_ID')?.trim() ?? '';
    const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI')?.trim() ?? '';
    const apiVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim() ?? 'development';

    if (!/^\d+$/.test(appId) || !/^v\d+\.\d+$/.test(apiVersion)) {
      throw new ServiceUnavailableException('Meta OAuth is not configured');
    }

    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      throw new ServiceUnavailableException('Meta OAuth is not configured');
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
      throw new ServiceUnavailableException('Meta OAuth is not configured');
    }

    return { appId, redirectUri: parsedRedirect.toString(), apiVersion };
  }
}
