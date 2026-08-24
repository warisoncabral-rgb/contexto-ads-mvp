import { Controller, Get, Headers, Param } from '@nestjs/common';
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
}
