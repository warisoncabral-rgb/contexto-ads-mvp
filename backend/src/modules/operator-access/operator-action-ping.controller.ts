import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorActionPingController {
  constructor(private readonly access: OperatorAccessService) {}

  @Get('action-ping')
  async ping(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const workspace = await this.access.listTenants(this.operatorAuthorization(authorization, operatorKey));
    return {
      action_status: 'OK' as const,
      service: 'contexto-ads-generator',
      schema_version: '1.0.8',
      authenticated: true,
      authorized_tenant_count: workspace.tenants.length,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    };
  }

  @Post('transport-post-ping')
  @HttpCode(200)
  async transportPostPing(@Body() body: { probe?: string }) {
    return {
      action_status: 'OK' as const,
      service: 'contexto-ads-generator',
      method: 'POST' as const,
      transport: 'reachable' as const,
      authenticated: false,
      probe: body?.probe === 'ok' ? 'ok' as const : 'invalid' as const,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    };
  }

  @Post('action-post-ping')
  // GPT Actions schema declares this diagnostic operation as an explicit HTTP 200 response.
  @HttpCode(200)
  async postPing(
    @Body() body: { probe?: string },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const workspace = await this.access.listTenants(this.operatorAuthorization(authorization, operatorKey));
    return {
      action_status: 'OK' as const,
      service: 'contexto-ads-generator',
      method: 'POST' as const,
      authenticated: true,
      probe: body?.probe === 'ok' ? 'ok' as const : 'invalid' as const,
      authorized_tenant_count: workspace.tenants.length,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    };
  }

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
  }
}
