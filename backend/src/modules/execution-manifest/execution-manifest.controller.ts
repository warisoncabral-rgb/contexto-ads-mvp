import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ExecutionManifestService } from './execution-manifest.service';

@Controller()
export class ExecutionManifestController {
  constructor(private readonly service: ExecutionManifestService) {}

  @Post('campaigns/:campaignId/plans/:executionPlanId/execution-manifests')
  prepare(
    @Param('campaignId') campaignId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Body() body: { tenantId: string; approvalId?: string },
  ) {
    return this.service.prepare(
      body?.tenantId, campaignId, executionPlanId, body?.approvalId,
    );
  }

  @Get('plans/:executionPlanId/execution-manifests/latest')
  latest(
    @Param('executionPlanId') executionPlanId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, executionPlanId);
  }
}
