import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { CampaignPackageHandoffService } from '../campaign-package/campaign-package-handoff.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorCampaignPackageController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly handoff: CampaignPackageHandoffService,
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
}
