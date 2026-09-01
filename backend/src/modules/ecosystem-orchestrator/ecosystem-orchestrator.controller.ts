import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { EcosystemOrchestratorService } from './ecosystem-orchestrator.service';

@Controller('operator/ecosystem')
export class EcosystemOrchestratorController {
  constructor(private readonly orchestrator: EcosystemOrchestratorService) {}

  @Get('overview')
  overview(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.orchestrator.overview(this.operatorAuthorization(authorization, operatorKey));
  }

  @Get('campaigns/:campaignId')
  campaign(
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.orchestrator.campaign(
      this.operatorAuthorization(authorization, operatorKey),
      campaignId,
    );
  }

  @Post('advance-safe')
  advanceAllSafe(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.orchestrator.advanceAllSafe(
      this.operatorAuthorization(authorization, operatorKey),
    );
  }

  @Post('campaigns/:campaignId/advance-safe')
  advanceSafe(
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.orchestrator.advanceSafe(
      this.operatorAuthorization(authorization, operatorKey),
      campaignId,
    );
  }

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
  }
}
