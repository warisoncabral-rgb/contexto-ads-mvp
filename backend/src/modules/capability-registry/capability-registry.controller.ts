import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MetaTenantOwnerGuard } from '../meta-connection/meta-tenant-owner.guard';
import { CapabilityRegistryService } from './capability-registry.service';

@Controller('meta/connections')
@UseGuards(MetaTenantOwnerGuard)
export class CapabilityRegistryController {
  constructor(private readonly service: CapabilityRegistryService) {}

  @Get(':connectionId/capabilities')
  list(
    @Param('connectionId') connectionId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.list(tenantId, connectionId);
  }

  @Post(':connectionId/capabilities/validate')
  validateReadOnly(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.validateReadOnly(body.tenantId, connectionId);
  }
}
