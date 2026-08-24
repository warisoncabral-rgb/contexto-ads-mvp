import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok' as const,
      service: 'contexto-ads-backend',
      externalWritesEnabled: false,
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.pool.query('select 1 as ok');
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        databaseReachable: false,
        externalWritesEnabled: false,
      });
    }

    const metaEnvironmentConfigured = this.metaEnvironmentConfigured();
    const operatorBootstrapConfigured = Boolean(
      this.config.get<string>('OPERATOR_BOOTSTRAP_SUBJECT')?.trim()
      && /^[0-9a-f]{64}$/i.test(this.config.get<string>('OPERATOR_BOOTSTRAP_TOKEN_SHA256')?.trim() ?? ''),
    );
    return {
      status: 'ready' as const,
      databaseReachable: true,
      operatorBootstrapConfigured,
      metaEnvironmentConfigured,
      realMetaSmokeMayStillRequireExternalConsent: true,
      externalWritesEnabled: false,
    };
  }

  private metaEnvironmentConfigured(): boolean {
    const appId = this.config.get<string>('META_APP_ID')?.trim() ?? '';
    const appSecret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI')?.trim() ?? '';
    const frontendBaseUrl = this.config.get<string>('CONTEXT_ADS_FRONTEND_BASE_URL')?.trim() ?? '';
    return /^\d+$/.test(appId) && appSecret.length >= 16
      && this.safeUrl(redirectUri, true) && this.safeUrl(frontendBaseUrl, false);
  }

  private safeUrl(value: string, allowCallbackPath: boolean): boolean {
    try {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return false;
      if (url.username || url.password || url.hash) return false;
      if (!allowCallbackPath && (url.search || url.pathname !== '/')) return false;
      return true;
    } catch { return false; }
  }
}
