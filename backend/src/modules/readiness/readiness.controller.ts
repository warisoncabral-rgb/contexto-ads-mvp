import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MetaTenantOwnerGuard } from '../meta-connection/meta-tenant-owner.guard';
import { ReadinessService } from './readiness.service';

@Controller('readiness')
@UseGuards(MetaTenantOwnerGuard)
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Get(':connectionId')
  get(@Param('connectionId') connectionId: string, @Query('tenantId') tenantId: string) {
    return this.service.getConnectionReadiness(tenantId, connectionId);
  }

  @Post(':connectionId/snapshots')
  capture(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.captureConnectionReadiness(body.tenantId, connectionId);
  }

  @Get(':connectionId/snapshots/latest')
  latestSnapshot(
    @Param('connectionId') connectionId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latestConnectionReadiness(tenantId, connectionId);
  }

  @Post(':connectionId/smoke-test')
  smokeTest(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.runReadOnlySmokeTest(body.tenantId, connectionId);
  }

  @Get(':connectionId/smoke-test/latest')
  latestSmokeTest(
    @Param('connectionId') connectionId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latestReadOnlySmokeTest(tenantId, connectionId);
  }
}
