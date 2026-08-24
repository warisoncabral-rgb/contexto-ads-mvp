import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { CampaignContextInput } from '../../domain/contracts/campaign-context';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorAccessController {
  constructor(private readonly service: OperatorAccessService) {}

  @Get('tenants')
  listTenants(@Headers('authorization') authorization: string | undefined) {
    return this.service.listTenants(authorization);
  }

  @Get('tenants/:tenantId/plans')
  listTenantPlans(
    @Param('tenantId') tenantId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.listTenantPlans(authorization, tenantId);
  }

  @Get('tenants/:tenantId/plans/:executionPlanId/readiness')
  latestReadiness(
    @Param('tenantId') tenantId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.latestReadiness(authorization, tenantId, executionPlanId);
  }

  @Get('tenants/:tenantId/campaign-contexts')
  listCampaignContexts(
    @Param('tenantId') tenantId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.listCampaignContexts(authorization, tenantId);
  }

  @Post('tenants/:tenantId/campaign-contexts')
  createCampaignContext(
    @Param('tenantId') tenantId: string,
    @Body() body: { facts?: CampaignContextInput },
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.createCampaignContext(authorization, tenantId, body?.facts);
  }

  @Post('tenants/:tenantId/campaign-contexts/:campaignId/versions')
  updateCampaignContext(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: { facts?: CampaignContextInput },
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.updateCampaignContext(
      authorization,
      tenantId,
      campaignId,
      body?.facts,
    );
  }

  @Post('tenants/:tenantId/campaigns/:campaignId/plans')
  generateExecutionPlan(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: { contextVersion?: number },
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.service.generateExecutionPlan(
      authorization,
      tenantId,
      campaignId,
      body?.contextVersion,
    );
  }
}
