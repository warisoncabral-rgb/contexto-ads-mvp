import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ExecutionSimulationService } from './execution-simulation.service';

@Controller()
export class ExecutionSimulationController {
  constructor(private readonly service: ExecutionSimulationService) {}

  @Post('campaigns/:campaignId/plans/:executionPlanId/target')
  bindTarget(
    @Param('campaignId') campaignId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Body() body: { tenantId: string; connectionId: string; adAccountId: string },
  ) {
    return this.service.bindTarget(
      body?.tenantId,
      campaignId,
      executionPlanId,
      body?.connectionId,
      body?.adAccountId,
    );
  }

  @Post('campaigns/:campaignId/plans/:executionPlanId/simulations')
  simulate(
    @Param('campaignId') campaignId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Body() body: { tenantId: string; approvalId?: string },
  ) {
    return this.service.simulate(
      body?.tenantId,
      campaignId,
      executionPlanId,
      body?.approvalId,
    );
  }

  @Get('plans/:executionPlanId/simulations/latest')
  latest(
    @Param('executionPlanId') executionPlanId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latestSimulation(tenantId, executionPlanId);
  }
}
