import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MetaConnectionService } from './meta-connection.service';
import { MetaTenantOwnerGuard } from './meta-tenant-owner.guard';

@Controller('meta/connections')
@UseGuards(MetaTenantOwnerGuard)
export class MetaConnectionController {
  constructor(private readonly service: MetaConnectionService) {}

  @Post('start')
  start(@Body() body: { tenantId: string }) {
    return this.service.beginConnection(body.tenantId);
  }

  @Get(':connectionId')
  get(@Param('connectionId') connectionId: string, @Query('tenantId') tenantId: string) {
    return this.service.getConnection(tenantId, connectionId);
  }

  @Post(':connectionId/discover-assets')
  discoverAssets(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.discoverAssets(body.tenantId, connectionId);
  }

  @Get(':connectionId/assets')
  listAssets(
    @Param('connectionId') connectionId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.listAssets(tenantId, connectionId);
  }

  @Get(':connectionId/ad-accounts/:adAccountId')
  readAdAccount(
    @Param('connectionId') connectionId: string,
    @Param('adAccountId') adAccountId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.readDiscoveredAdAccount(tenantId, connectionId, adAccountId);
  }
}
