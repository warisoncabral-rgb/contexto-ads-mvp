import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ExecutionAuthorizationService } from './execution-authorization.service';

@Controller()
export class ExecutionAuthorizationController {
  constructor(private readonly service: ExecutionAuthorizationService) {}

  @Post('execution-manifests/:executionManifestId/authorizations')
  request(@Param('executionManifestId') id: string,
    @Body() body: { tenantId: string; requestedBy: string }) {
    return this.service.request(body?.tenantId, id, body?.requestedBy);
  }

  @Get('execution-authorizations/:id')
  get(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.service.get(tenantId, id);
  }

  @Post('execution-authorizations/:id/approve')
  approve(@Param('id') id: string,
    @Body() body: { tenantId: string; approvedBy: string }) {
    return this.service.approve(body?.tenantId, id, body?.approvedBy);
  }

  @Post('execution-authorizations/:id/reject')
  reject(@Param('id') id: string,
    @Body() body: { tenantId: string; rejectedBy: string; reason: string }) {
    return this.service.reject(body?.tenantId, id, body?.rejectedBy, body?.reason);
  }

  @Post('execution-authorizations/:id/revoke')
  revoke(@Param('id') id: string,
    @Body() body: { tenantId: string; revokedBy: string; reason: string }) {
    return this.service.revoke(body?.tenantId, id, body?.revokedBy, body?.reason);
  }

  @Post('execution-authorizations/:id/preflights')
  preflight(@Param('id') id: string, @Body() body: { tenantId: string }) {
    return this.service.preflight(body?.tenantId, id);
  }
}
