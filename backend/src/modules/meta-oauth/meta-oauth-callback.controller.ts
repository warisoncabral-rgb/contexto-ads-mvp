import { Controller, Get, Query, Redirect, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaOAuthService } from './meta-oauth.service';

@Controller('meta/oauth')
export class MetaOAuthCallbackController {
  constructor(
    private readonly service: MetaOAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  @Redirect()
  async callback(
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ) {
    const result = await this.service.callback({ state, code, error });
    const frontendBaseUrl = this.frontendBaseUrl();
    const url = new URL('/connections', frontendBaseUrl);
    url.searchParams.set('oauth', 'connected');
    url.searchParams.set('connectionId', result.connectionId);
    return { url: url.toString(), statusCode: 303 };
  }

  private frontendBaseUrl(): URL {
    const configured = this.config.get<string>('CONTEXT_ADS_FRONTEND_BASE_URL')?.trim() ?? '';
    let url: URL;
    try { url = new URL(configured); } catch {
      throw new ServiceUnavailableException('Frontend callback destination is not configured');
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash) {
      throw new ServiceUnavailableException('Frontend callback destination is not configured');
    }
    return url;
  }
}
