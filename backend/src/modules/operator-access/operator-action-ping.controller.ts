import { Controller, Get, Headers } from '@nestjs/common';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorActionPingController {
  constructor(private readonly access: OperatorAccessService) {}

  @Get('action-ping')
  async ping(@Headers('authorization') authorization: string | undefined) {
    const workspace = await this.access.listTenants(authorization);
    return {
      action_status: 'OK' as const,
      service: 'contexto-ads-generator',
      schema_version: '1.0.10-diagnostic',
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
}
