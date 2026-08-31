import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { AnalystLearningService } from './analyst-learning.service';

@Controller('operator/tenants/:tenantId/campaigns/:campaignId/analyst/learning')
export class AnalystLearningController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly learning: AnalystLearningService,
  ) {}

  @Post('refresh')
  async refresh(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.learning.refresh(tenantId, campaignId, operator.subject);
  }

  @Get('latest')
  async latest(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.learning.latest(tenantId, campaignId);
  }
}
