import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import {
  AnalystAnalyzeInputV1,
  AnalystBusinessConstraintsV1,
} from '../../domain/contracts/analyst';
import { AnalystTrackingService } from '../analyst-tracking/analyst-tracking.service';
import { MetaInsightsService } from '../meta-insights/meta-insights.service';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { AnalystGovernanceService } from './analyst-governance.service';
import { AnalystMetaCampaignResolverService } from './analyst-meta-campaign-resolver.service';
import { AnalystPresenter } from './analyst.presenter';
import { AnalystService } from './analyst.service';

interface CollectMetaBody {
  metaCampaignId?: string;
  since: string;
  until: string;
  businessConstraints?: AnalystBusinessConstraintsV1;
}

@Controller('operator/tenants/:tenantId/campaigns/:campaignId/analyst')
export class AnalystController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly analyst: AnalystService,
    private readonly metaInsights: MetaInsightsService,
    private readonly presenter: AnalystPresenter,
    private readonly metaCampaignResolver: AnalystMetaCampaignResolverService,
    private readonly governance: AnalystGovernanceService,
    private readonly tracking: AnalystTrackingService,
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
    const analyzed = await this.analyst.analyze(tenantId, campaignId, body, operator.subject);
    return {
      ...analyzed,
      user_brief: this.presenter.present(analyzed.analysis),
    };
  }

  @Post('collect-meta')
  async collectMeta(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: CollectMetaBody,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );

    const suppliedMetaCampaignId = typeof body?.metaCampaignId === 'string'
      && /^\d+$/.test(body.metaCampaignId)
      ? body.metaCampaignId
      : null;
    const resolved = suppliedMetaCampaignId
      ? null
      : await this.metaCampaignResolver.resolve(tenantId, campaignId);
    const metaCampaignId = suppliedMetaCampaignId ?? resolved?.externalCampaignId ?? null;

    if (!metaCampaignId) {
      return {
        action_status: 'AWAITING_META_LINK',
        situation: 'A campanha ainda não possui um vínculo Meta confirmado no sistema.',
        next_step: 'Conclua o vínculo da campanha com a Meta. Depois disso, a coleta será feita automaticamente.',
        user_action_required: true,
        technical_id_required_from_user: false,
        analysis: null,
        boundaries: {
          shadow_mode: true,
          meta_write_performed: false,
          external_writes_allowed: false,
          recommendation_auto_executed: false,
        },
      };
    }

    const meta = await this.metaInsights.readSelectedCampaign(
      tenantId,
      metaCampaignId,
      body?.since,
      body?.until,
    );
    if (!meta.success || !meta.data) {
      return {
        action_status: 'UNAVAILABLE',
        user_message: this.unavailableMessage(meta.normalizedError),
        next_step: meta.retryable
          ? 'Aguarde e tente a leitura novamente. Nenhuma alteração na campanha foi realizada.'
          : 'Revise a conexão e as permissões de leitura da Meta antes de uma nova análise.',
        meta_campaign_resolution: {
          automatic: !suppliedMetaCampaignId,
          source: suppliedMetaCampaignId ? 'integration_input' : resolved?.source ?? 'unknown',
          technical_id_required_from_user: false,
        },
        meta_insights: meta,
        analysis: null,
        boundaries: {
          shadow_mode: true,
          meta_write_performed: false,
          external_writes_allowed: false,
          recommendation_auto_executed: false,
        },
      };
    }

    const periodStart = `${body.since}T00:00:00.000Z`;
    const periodEnd = `${body.until}T23:59:59.999Z`;
    const campaignAgeHours = this.hoursBetween(meta.data.createdTime, periodEnd);
    const hoursSinceLastChange = meta.data.updatedTime
      ? this.hoursBetween(meta.data.updatedTime, periodEnd)
      : undefined;
    const analyzed = await this.analyst.analyze(
      tenantId,
      campaignId,
      {
        businessConstraints: body.businessConstraints,
        campaignStatus: {
          meta_campaign_id: meta.data.campaignId,
          meta_effective_status: meta.data.effectiveStatus ?? meta.data.status,
          result_action_type: meta.data.resultActionType,
          currency: meta.data.currency,
          actions: meta.data.actions,
        },
        snapshot: {
          periodStart,
          periodEnd,
          campaignStatus: meta.data.effectiveStatus ?? meta.data.status,
          campaignAgeHours,
          ...(hoursSinceLastChange === undefined ? {} : { hoursSinceLastChange }),
          source: 'meta_readonly' as const,
          metrics: {
            impressions: meta.data.impressions,
            reach: meta.data.reach,
            spendMinor: meta.data.spendMinor,
            results: meta.data.results,
            clicks: meta.data.clicks,
            ...(meta.data.frequency === undefined ? {} : { frequency: meta.data.frequency }),
            ...(meta.data.ctr === undefined ? {} : { ctr: meta.data.ctr }),
            ...(meta.data.cpcMinor === undefined ? {} : { cpcMinor: meta.data.cpcMinor }),
            ...(meta.data.results > 0
              ? { costPerResultMinor: meta.data.spendMinor / meta.data.results }
              : {}),
          },
        },
      },
      operator.subject,
    );

    return {
      action_status: 'ANALYZED',
      user_brief: this.presenter.present(analyzed.analysis),
      meta_campaign_resolution: {
        automatic: !suppliedMetaCampaignId,
        source: suppliedMetaCampaignId ? 'integration_input' : resolved?.source ?? 'unknown',
        technical_id_required_from_user: false,
      },
      meta_insights: meta.data,
      ...analyzed,
      boundaries: {
        shadow_mode: true,
        meta_write_performed: false,
        external_writes_allowed: false,
        recommendation_auto_executed: false,
        financial_action_authorized: false,
      },
    };
  }

  @Get('tracking')
  async trackingEvidence(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    const registration = await this.tracking.find(tenantId, campaignId);
    if (!registration) {
      return {
        action_status: 'NOT_FOUND',
        tenant_id: tenantId,
        campaign_id: campaignId,
        technical_id_required_from_user: false,
        boundaries: {
          tracking_only: true,
          execution_authorized: false,
          meta_write_performed: false,
          external_writes_allowed: false,
          recommendation_auto_executed: false,
        },
      };
    }
    return {
      action_status: 'FOUND',
      registration,
      technical_id_required_from_user: false,
    };
  }

  @Get('summary')
  async summary(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    const latest = await this.analyst.latest(tenantId, campaignId);
    if (!latest.analysis) {
      return {
        action_status: 'NO_ANALYSIS',
        situation: 'Ainda não existe análise suficiente para esta campanha.',
        next_step: 'A coleta automática fará o acompanhamento quando houver dados disponíveis.',
        user_action_required: false,
      };
    }
    return {
      action_status: 'OK',
      ...this.presenter.present(latest.analysis),
    };
  }

  @Get('alert')
  async alert(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.governance.essentialAlert(tenantId, campaignId);
  }

  @Get('recommendations/latest')
  async latestRecommendationDecision(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.governance.latestDecision(tenantId, campaignId);
  }

  @Post('recommendations/:decision')
  async decideRecommendation(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Param('decision') decision: string,
    @Body() body: { reason?: string },
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.governance.decideLatest(
      tenantId,
      campaignId,
      decision,
      operator.subject,
      body?.reason,
    );
  }

  @Get('latest')
  async latest(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    const latest = await this.analyst.latest(tenantId, campaignId);
    return {
      ...latest,
      user_brief: latest.analysis ? this.presenter.present(latest.analysis) : null,
    };
  }

  private unavailableMessage(error: string | undefined): string {
    if (error === 'AUTH_PERMISSION') {
      return 'Não foi possível ler os dados da Meta com a autorização atual.';
    }
    if (error === 'TRANSIENT_API') {
      return 'A Meta está temporariamente indisponível para esta leitura.';
    }
    if (error === 'VALIDATION') {
      return 'Os dados recebidos da Meta não puderam ser validados com segurança.';
    }
    return 'Não foi possível concluir a leitura da campanha neste momento.';
  }

  private hoursBetween(from: string | undefined, to: string): number {
    if (!from || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return 0;
    return Math.max(0, (Date.parse(to) - Date.parse(from)) / 3_600_000);
  }
}
