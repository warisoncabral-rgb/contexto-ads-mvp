import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EcosystemCampaignHumanStatusV1,
  EcosystemOverviewV1,
} from '../../domain/contracts/ecosystem-orchestrator';
import { AnalystTrackingService } from '../analyst-tracking/analyst-tracking.service';
import { AnalystPresenter } from '../analyst/analyst.presenter';
import { AnalystService } from '../analyst/analyst.service';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { OperatorAccessService } from '../operator-access/operator-access.service';

type PackageStatus = Awaited<ReturnType<CampaignPackageStatusService['get']>>;
type AnalystBrief = ReturnType<AnalystPresenter['present']>;

@Injectable()
export class EcosystemOrchestratorService {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly packages: CampaignPackageStatusService,
    private readonly analyst: AnalystService,
    private readonly presenter: AnalystPresenter,
    private readonly tracking: AnalystTrackingService,
    private readonly connections: MetaConnectionService,
  ) {}

  async overview(authorization: string | undefined): Promise<EcosystemOverviewV1> {
    const portfolio = await this.access.portfolio(authorization);
    const campaigns = await Promise.all(portfolio.items.map((item) =>
      this.describeCampaign(item.tenantId, item.campaignId, item.executionPlanId)));
    const userActionCount = campaigns.filter((item) => item.userActionRequired).length;
    const monitoringCount = campaigns.filter((item) =>
      item.stage === 'MONITORING' || item.stage === 'ANALYSIS_WAITING').length;
    const blockedCount = campaigns.filter((item) => item.stage === 'BLOCKED').length;

    return {
      actionStatus: 'OK',
      headline: campaigns.length === 0
        ? 'Nenhuma campanha está em preparação ou acompanhamento.'
        : userActionCount > 0
          ? `Ecossistema funcionando. ${userActionCount} campanha(s) precisam de uma decisão sua.`
          : 'Ecossistema funcionando. Nenhuma ação sua é necessária agora.',
      simpleMessage: campaigns.length === 0
        ? 'Quando uma campanha for concluída no Contexto Ads, o restante do fluxo aparecerá aqui automaticamente.'
        : 'Contexto Ads, Gerador e Analista estão sendo apresentados como um único fluxo. Os detalhes técnicos continuam rastreáveis, mas ficam fora do seu caminho.',
      userActionRequired: userActionCount > 0,
      campaigns,
      summary: { campaignCount: campaigns.length, monitoringCount, userActionCount, blockedCount },
      boundaries: this.boundaries(),
    };
  }

  async campaign(
    authorization: string | undefined,
    campaignId: string,
  ): Promise<EcosystemCampaignHumanStatusV1> {
    const target = await this.authorizedCampaign(authorization, campaignId);
    return this.describeCampaign(target.tenantId, target.campaignId, target.executionPlanId);
  }

  async advanceAllSafe(authorization: string | undefined) {
    const portfolio = await this.access.portfolio(authorization);
    const results: Array<Record<string, unknown>> = [];

    for (const item of portfolio.items) {
      let status: PackageStatus;
      try {
        status = await this.packages.get(item.tenantId, item.campaignId);
      } catch {
        results.push({
          campaignId: item.campaignId,
          actionStatus: 'NO_SAFE_STEP',
          simpleMessage: 'A campanha ainda não tem um pacote pronto para avanço interno.',
        });
        continue;
      }

      if (!['RESOLVE_META_TARGET', 'REQUEST_EXECUTION_PLAN_APPROVAL'].includes(status.next_action)) {
        results.push({
          campaignId: item.campaignId,
          actionStatus: 'NO_SAFE_STEP',
          nextAction: status.next_action,
          simpleMessage: 'A campanha já está em um ponto que exige revisão, decisão humana ou um gate externo.',
        });
        continue;
      }

      try {
        const result = await this.advanceSafe(authorization, item.campaignId);
        results.push({ campaignId: item.campaignId, ...result });
      } catch {
        results.push({
          campaignId: item.campaignId,
          actionStatus: 'SAFE_STEP_FAILED',
          simpleMessage: 'Não foi possível concluir o avanço interno desta campanha. Nenhum efeito externo foi executado.',
        });
      }
    }

    const advancedCount = results.filter((item) => item.actionStatus === 'SAFE_STEPS_COMPLETED').length;
    const failedCount = results.filter((item) => item.actionStatus === 'SAFE_STEP_FAILED').length;

    return {
      actionStatus: 'SAFE_BATCH_COMPLETED',
      headline: advancedCount > 0
        ? `${advancedCount} campanha(s) avançaram automaticamente até o próximo gate humano.`
        : 'Não havia etapas internas seguras pendentes para avançar automaticamente.',
      simpleMessage: failedCount > 0
        ? `${failedCount} campanha(s) precisam de revisão técnica, mas nenhuma ação externa foi executada.`
        : 'O ecossistema executou somente etapas internas permitidas e parou antes de qualquer decisão ou efeito externo.',
      advancedCount,
      failedCount,
      campaignCount: results.length,
      results,
      boundaries: this.boundaries(),
    };
  }

  async advanceSafe(authorization: string | undefined, campaignId: string) {
    const target = await this.authorizedCampaign(authorization, campaignId);
    let status = await this.packages.get(target.tenantId, campaignId);
    const completedSteps: string[] = [];

    if (status.next_action === 'RESOLVE_META_TARGET') {
      const selected = await this.connections.selectedExecutionTarget(target.tenantId);
      await this.access.bindExecutionTarget(
        authorization,
        target.tenantId,
        campaignId,
        status.execution_plan.execution_plan_id,
        selected.connectionId,
        selected.adAccountId,
      );
      completedSteps.push('META_TARGET_RESOLVED');
      status = await this.packages.get(target.tenantId, campaignId);
    }

    if (status.next_action === 'REQUEST_EXECUTION_PLAN_APPROVAL') {
      const approval = await this.access.requestPlanApproval(
        authorization,
        target.tenantId,
        campaignId,
        status.execution_plan.execution_plan_id,
      );
      completedSteps.push('PLAN_APPROVAL_REQUEST_PREPARED');
      return {
        ...this.safeStep(
          'SAFE_STEPS_COMPLETED',
          'O Gerador terminou o que podia fazer sozinho. Agora preciso apenas da sua decisão.',
          completedSteps.includes('META_TARGET_RESOLVED')
            ? 'Resolvi a conta/ativos da Meta e deixei a aprovação do plano pronta, tudo sem publicar ou ativar campanha.'
            : 'Deixei a aprovação do plano pronta, sem publicar ou ativar campanha.',
          'Revise e aprove ou rejeite o plano quando quiser continuar.',
          true,
          'Aprovar ou rejeitar o plano de campanha.',
        ),
        completedSteps,
        technicalDetails: {
          approvalId: approval.approval.approvalId,
          approvalStatus: approval.approval.status,
        },
      };
    }

    if (status.next_action === 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE') {
      return {
        ...this.safeStep(
          'USER_DECISION_REQUIRED',
          'O criativo precisa da sua revisão.',
          'O sistema não vai fingir que viu ou aprovou uma peça visual por você.',
          'Revise a peça e confirme se ela está fiel ao que foi aprovado.',
          true,
          'Aprovar ou pedir ajuste no criativo.',
        ),
        completedSteps,
      };
    }

    if (status.next_action === 'DECIDE_EXECUTION_PLAN_APPROVAL') {
      return {
        ...this.safeStep(
          'USER_DECISION_REQUIRED',
          'O plano está aguardando sua decisão.',
          'Todo o trabalho técnico anterior já foi feito. Agora só falta aprovar ou rejeitar este plano.',
          'Aprove ou rejeite o plano. Isso ainda não publica nem ativa campanha.',
          true,
          'Aprovar ou rejeitar o plano de campanha.',
        ),
        completedSteps,
      };
    }

    return {
      ...this.safeStep(
        'EXTERNAL_GATE_REACHED',
        'Chegamos ao limite da automação segura.',
        'O ecossistema concluiu o que podia fazer sem autorização de efeito externo.',
        'Qualquer criação, publicação, ativação ou ação financeira continua exigindo autorização específica.',
        true,
        'Decidir se deseja avançar pelo gate externo apropriado.',
      ),
      completedSteps,
    };
  }

  private async authorizedCampaign(authorization: string | undefined, campaignId: string) {
    const portfolio = await this.access.portfolio(authorization);
    const target = portfolio.items.find((item) => item.campaignId === campaignId);
    if (!target) throw new NotFoundException('Campaign was not found in the authorized workspace');
    return target;
  }

  private async describeCampaign(
    tenantId: string,
    campaignId: string,
    fallbackExecutionPlanId: string,
  ): Promise<EcosystemCampaignHumanStatusV1> {
    let status: PackageStatus;
    try {
      status = await this.packages.get(tenantId, campaignId);
    } catch {
      return this.baseStatus(tenantId, campaignId, {
        activeModule: 'contexto_ads', stage: 'CONTEXT_REQUIRED', progressPercent: 20,
        headline: 'A estratégia ainda precisa ser concluída no Contexto Ads.',
        simpleMessage: 'Ainda não existe um pacote completo para o Gerador trabalhar.',
        whatSystemDid: 'Preservei o que já existe e não inventei informações para preencher lacunas.',
        nextStep: 'Concluir apenas as informações realmente necessárias no Contexto Ads.',
        userActionRequired: true,
        userAction: 'Responder às pendências materiais do Contexto Ads.',
      }, {
        executionPlanId: fallbackExecutionPlanId ?? null,
        packageNextAction: null, creativeStatus: null, targetBindingStatus: null,
        planApprovalStatus: null, trackingRegistered: false,
        analystDecision: null, analystOperationalState: null,
      });
    }

    const tracking = await this.tracking.find(tenantId, campaignId);
    const latest = await this.analyst.latest(tenantId, campaignId);
    const brief: AnalystBrief | null = latest.analysis ? this.presenter.present(latest.analysis) : null;

    if (tracking && latest.analysis?.requiresApproval) {
      return this.fromPackage(tenantId, status, true, brief, {
        activeModule: 'user', stage: 'ANALYST_DECISION', progressPercent: 100,
        headline: 'O Analista encontrou uma decisão que merece sua aprovação.',
        simpleMessage: brief?.simpleMessage ?? 'Existe uma recomendação pronta para sua decisão.',
        whatSystemDid: 'O Analista coletou dados, comparou o histórico e preparou uma recomendação sem executá-la.',
        nextStep: brief?.nextStep ?? 'Revise a recomendação antes de qualquer alteração.',
        userActionRequired: true,
        userAction: brief?.userAction ?? 'Aprovar ou rejeitar a recomendação.',
      });
    }

    if (tracking && brief) {
      return this.fromPackage(tenantId, status, true, brief, {
        activeModule: 'analyst', stage: 'MONITORING', progressPercent: 100,
        headline: brief.situation,
        simpleMessage: brief.simpleMessage,
        whatSystemDid: 'A campanha foi vinculada ao Analista e está sendo acompanhada automaticamente.',
        nextStep: brief.nextStep,
        userActionRequired: brief.userActionRequired,
        userAction: brief.userAction,
      });
    }

    if (tracking) {
      return this.fromPackage(tenantId, status, true, brief, {
        activeModule: 'analyst', stage: 'ANALYSIS_WAITING', progressPercent: 90,
        headline: 'A campanha já chegou ao Analista.',
        simpleMessage: 'O vínculo com a campanha real está pronto; falta apenas uma janela de dados útil.',
        whatSystemDid: 'O Gerador concluiu o vínculo técnico e o Analista já sabe qual campanha acompanhar.',
        nextStep: 'A coleta automática fará a análise quando houver dados disponíveis.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária agora.',
      });
    }

    if (status.creative?.status !== 'approved') {
      return this.fromPackage(tenantId, status, false, brief, {
        activeModule: 'user', stage: 'CREATIVE_REVIEW', progressPercent: 45,
        headline: 'A estratégia já chegou ao Gerador; falta revisar o criativo.',
        simpleMessage: 'Os dados estão preservados. A fidelidade visual precisa de confirmação real.',
        whatSystemDid: 'O Contexto Ads entregou a estratégia e o Gerador preparou o pacote técnico sem publicar nada.',
        nextStep: 'Revise o criativo e confirme se está correto.',
        userActionRequired: true,
        userAction: 'Aprovar ou pedir ajuste no criativo.',
      });
    }

    if (status.execution_plan.target_binding_status !== 'BOUND') {
      return this.fromPackage(tenantId, status, false, brief, {
        activeModule: 'generator', stage: 'TARGET_RESOLUTION', progressPercent: 55,
        headline: 'O Gerador está resolvendo onde a campanha será criada.',
        simpleMessage: 'Conta de anúncios e ativos técnicos podem ser recuperados da conexão já selecionada.',
        whatSystemDid: 'A estratégia e o criativo já estão prontos; não vou pedir novamente o que o sistema já sabe.',
        nextStep: 'Executar o próximo passo seguro para resolver o alvo Meta.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária agora.',
      });
    }

    if (status.next_action === 'REQUEST_EXECUTION_PLAN_APPROVAL') {
      return this.fromPackage(tenantId, status, false, brief, {
        activeModule: 'generator', stage: 'PLAN_APPROVAL_PREPARATION', progressPercent: 65,
        headline: 'O Gerador terminou o plano técnico.',
        simpleMessage: 'O sistema pode abrir a aprovação para você sem publicar nada.',
        whatSystemDid: 'Estruturei campanha, orçamento, ativos e plano com base na estratégia aprovada.',
        nextStep: 'Executar o próximo passo seguro para preparar a aprovação.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária até a aprovação ser aberta.',
      });
    }

    if (status.next_action === 'DECIDE_EXECUTION_PLAN_APPROVAL') {
      return this.fromPackage(tenantId, status, false, brief, {
        activeModule: 'user', stage: 'PLAN_APPROVAL_REQUIRED', progressPercent: 70,
        headline: 'O plano está pronto para sua decisão.',
        simpleMessage: 'Você só precisa dizer se aprova ou rejeita. Isso ainda não coloca campanha no ar.',
        whatSystemDid: 'O Gerador concluiu todas as etapas internas anteriores à decisão humana.',
        nextStep: 'Aprovar ou rejeitar o plano.',
        userActionRequired: true,
        userAction: 'Aprovar ou rejeitar o plano de campanha.',
      });
    }

    return this.fromPackage(tenantId, status, false, brief, {
      activeModule: 'user', stage: 'EXTERNAL_EXECUTION_GATE', progressPercent: 80,
      headline: 'A preparação interna terminou.',
      simpleMessage: 'Qualquer avanço daqui pode produzir efeito externo, então o sistema parou corretamente.',
      whatSystemDid: 'Contexto Ads e Gerador concluíram a preparação segura e preservaram versões e aprovações.',
      nextStep: 'Só avançar mediante a autorização externa específica prevista para esta etapa.',
      userActionRequired: true,
      userAction: 'Decidir se deseja avançar pelo gate externo.',
    });
  }

  private fromPackage(
    tenantId: string,
    status: PackageStatus,
    trackingRegistered: boolean,
    brief: AnalystBrief | null,
    human: Pick<EcosystemCampaignHumanStatusV1,
      'activeModule' | 'stage' | 'progressPercent' | 'headline' | 'simpleMessage'
      | 'whatSystemDid' | 'nextStep' | 'userActionRequired' | 'userAction'>,
  ): EcosystemCampaignHumanStatusV1 {
    return this.baseStatus(tenantId, status.campaign_id, human, {
      executionPlanId: status.execution_plan.execution_plan_id ?? null,
      packageNextAction: status.next_action ?? null,
      creativeStatus: status.creative?.status ?? null,
      targetBindingStatus: status.execution_plan.target_binding_status ?? null,
      planApprovalStatus: status.plan_approval?.status ?? null,
      trackingRegistered,
      analystDecision: brief?.decision ?? null,
      analystOperationalState: brief?.operationalState ?? null,
    });
  }

  private baseStatus(
    tenantId: string,
    campaignId: string,
    human: Pick<EcosystemCampaignHumanStatusV1,
      'activeModule' | 'stage' | 'progressPercent' | 'headline' | 'simpleMessage'
      | 'whatSystemDid' | 'nextStep' | 'userActionRequired' | 'userAction'>,
    technicalDetails: EcosystemCampaignHumanStatusV1['technicalDetails'],
  ): EcosystemCampaignHumanStatusV1 {
    return { tenantId, campaignId, ...human, technicalDetails, boundaries: this.boundaries() };
  }

  private safeStep(
    actionStatus: string,
    headline: string,
    simpleMessage: string,
    nextStep: string,
    userActionRequired: boolean,
    userAction: string,
  ) {
    return {
      actionStatus, headline, simpleMessage, nextStep, userActionRequired, userAction,
      boundaries: this.boundaries(),
    };
  }

  private boundaries() {
    return {
      publicationAuthorized: false as const,
      activationAuthorized: false as const,
      externalWritesAllowed: false as const,
      financialActionAuthorized: false as const,
      recommendationAutoExecuted: false as const,
    };
  }
}
