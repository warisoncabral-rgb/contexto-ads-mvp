import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { MetaOAuthAttempt } from '../../domain/contracts/meta-oauth-attempt';
import { MetaOAuthAttemptStore } from '../../domain/ports/repositories';
import { META_OAUTH_ATTEMPT_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const META_OAUTH_SCOPES = ['public_profile'] as const;
const META_AUTHORIZATION_ORIGIN = 'https://www.facebook.com';

@Injectable()
export class MetaOAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: MetaConnectionService,
    @Inject(META_OAUTH_ATTEMPT_REPOSITORY)
    private readonly attempts: MetaOAuthAttemptStore,
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
