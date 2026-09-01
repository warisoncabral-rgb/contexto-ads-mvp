import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { EcosystemOrchestratorService } from './ecosystem-orchestrator.service';

@Controller('operator/ecosystem')
export class EcosystemOrchestratorController {
  constructor(private readonly orchestrator: EcosystemOrchestratorService) {}

  @Get('overview')
  overview(@Headers('authorization') authorization: string | undefined) {
    return this.orchestrator.overview(authorization);
  }

  @Get('campaigns/:campaignId')
  campaign(
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.orchestrator.campaign(authorization, campaignId);
  }

  @Post('campaigns/:campaignId/advance-safe')
  advanceSafe(
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.orchestrator.advanceSafe(authorization, campaignId);
  }
}
