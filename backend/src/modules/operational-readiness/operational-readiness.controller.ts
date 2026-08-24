import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OperationalReadinessService } from './operational-readiness.service';

@Controller()
export class OperationalReadinessController {
  constructor(private readonly service: OperationalReadinessService) {}

  @Post('campaigns/:campaignId/plans/:executionPlanId/readiness-decisions')
  generate(
    @Param('campaignId') campaignId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Body() body: { tenantId: string; approvalId?: string },
  ) {
    return this.service.generate(
      body?.tenantId,
      campaignId,
      executionPlanId,
      body?.approvalId,
    );
  }

  @Get('plans/:executionPlanId/readiness-decisions/latest')
  latest(
    @Param('executionPlanId') executionPlanId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, executionPlanId);
  }
}
