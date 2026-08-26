import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { CampaignPackageHandoffService } from '../campaign-package/campaign-package-handoff.service';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorCampaignPackageController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly handoff: CampaignPackageHandoffService,
    private readonly status: CampaignPackageStatusService,
  ) {}

  @Post('tenants/:tenantId/campaign-packages/v1/submit')
  async submit(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.handoff.submit(tenantId, body, operator.subject);
  }

  @Get('tenants/:tenantId/campaign-packages/v1/:packageId/status')
  async getStatus(
    @Param('tenantId') tenantId: string,
    @Param('packageId') packageId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.status.get(tenantId, packageId);
  }
}
