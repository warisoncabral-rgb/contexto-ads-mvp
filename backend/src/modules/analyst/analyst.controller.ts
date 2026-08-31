import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AnalystAnalyzeInputV1 } from '../../domain/contracts/analyst';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { AnalystService } from './analyst.service';

@Controller('operator/tenants/:tenantId/campaigns/:campaignId/analyst')
export class AnalystController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly analyst: AnalystService,
  ) {}

  @Post('analyze')
  async analyze(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: AnalystAnalyzeInputV1,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.analyst.analyze(tenantId, campaignId, body, operator.subject);
  }

  @Get('latest')
  async latest(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.analyst.latest(tenantId, campaignId);
  }
}
