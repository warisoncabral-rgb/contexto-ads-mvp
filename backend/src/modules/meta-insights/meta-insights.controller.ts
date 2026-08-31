import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { MetaInsightsService } from './meta-insights.service';

@Controller('operator/tenants/:tenantId/meta/campaigns/:campaignId')
export class MetaInsightsController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly insights: MetaInsightsService,
  ) {}

  @Get('insights')
  async read(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Query('since') since: string,
    @Query('until') until: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.insights.readSelectedCampaign(tenantId, campaignId, since, until);
  }
}
