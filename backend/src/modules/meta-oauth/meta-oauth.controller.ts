import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { MetaTenantOwnerGuard } from '../meta-connection/meta-tenant-owner.guard';
import { MetaOAuthService } from './meta-oauth.service';

@Controller('meta/connections')
@UseGuards(MetaTenantOwnerGuard)
export class MetaOAuthController {
  constructor(private readonly service: MetaOAuthService) {}

  @Post(':connectionId/oauth/start')
  start(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.start(body.tenantId, connectionId);
  }
}
