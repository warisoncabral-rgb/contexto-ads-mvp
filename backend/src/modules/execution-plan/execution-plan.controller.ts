import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ExecutionPlanService } from './execution-plan.service';

interface GeneratePlanBody {
  tenantId: string;
  contextVersion?: number;
}

@Controller('campaigns/:campaignId/plans')
export class ExecutionPlanController {
  constructor(private readonly service: ExecutionPlanService) {}

  @Post()
  generate(
    @Param('campaignId') campaignId: string,
    @Body() body: GeneratePlanBody,
  ) {
    return this.service.generate(body?.tenantId, campaignId, body?.contextVersion);
  }

  @Get('latest')
  latest(
    @Param('campaignId') campaignId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, campaignId);
  }
}
