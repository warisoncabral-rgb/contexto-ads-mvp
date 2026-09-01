import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { EcosystemOrchestratorService } from './ecosystem-orchestrator.service';

@Controller('operator/ecosystem')
export class EcosystemOrchestratorController {
  constructor(private readonly orchestrator: EcosystemOrchestratorService) {}

  @Get('human-status')
  async humanStatus(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const result = await this.orchestrator.overview(
      this.operatorAuthorization(authorization, operatorKey),
    );
    return {
      status: result.headline,
      message: result.simpleMessage,
      needsYourDecision: result.userActionRequired,
      campaigns: result.campaigns.map((campaign) => ({
        whoIsWorking: this.humanModule(campaign.activeModule),
        progress: `${campaign.progressPercent}%`,
        status: campaign.headline,
        message: campaign.simpleMessage,
        whatAlreadyHappened: campaign.whatSystemDid,
        whatHappensNow: campaign.nextStep,
        needsYourDecision: campaign.userActionRequired,
        yourAction: campaign.userAction,
      })),
      safety: 'Nada é publicado, ativado ou autorizado para gastar sem uma decisão humana específica para essa etapa.',
    };
  }

  @Get('campaigns/:campaignId/human-status')
  async humanCampaign(
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const campaign = await this.orchestrator.campaign(
      this.operatorAuthorization(authorization, operatorKey),
      campaignId,
    );
    return {
      whoIsWorking: this.humanModule(campaign.activeModule),
      progress: `${campaign.progressPercent}%`,
      status: campaign.headline,
      message: campaign.simpleMessage,
      whatAlreadyHappened: campaign.whatSystemDid,
      whatHappensNow: campaign.nextStep,
      needsYourDecision: campaign.userActionRequired,
      yourAction: campaign.userAction,
      safety: 'Nada é publicado, ativado ou autorizado para gastar sem uma decisão humana específica para essa etapa.',
    };
  }

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

  private humanModule(module: 'contexto_ads' | 'generator' | 'analyst' | 'user') {
    const labels = {
      contexto_ads: 'Contexto Ads',
      generator: 'Gerador de Campanhas',
      analyst: 'Analista Ads',
      user: 'Você',
    } as const;
    return labels[module];
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
