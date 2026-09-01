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
    const headline = campaigns.length === 0
      ? 'Nenhuma campanha está em preparação ou acompanhamento.'
      : userActionCount > 0
        ? `Ecossistema funcionando. ${userActionCount} campanha(s) precisam de uma decisão sua.`
        : 'Ecossistema funcionando. Nenhuma ação sua é necessária agora.';

    return {
      actionStatus: 'OK',
      headline,
      simpleMessage: campaigns.length === 0
        ? 'Quando uma campanha for concluída no Contexto Ads, o restante do fluxo aparecerá aqui automaticamente.'
        : 'Contexto Ads, Gerador e Analista estão sendo apresentados como um único fluxo. Os detalhes técnicos ficam escondidos, mas continuam rastreáveis.',
      userActionRequired: userActionCount > 0,
      campaigns,
      summary: {
        campaignCount: campaigns.length,
        monitoringCount,
        userActionCount,
        blockedCount,
      },
      boundaries: this.boundaries(),
    };
  }

  async campaign(
    authorization: string | undefined,
    campaignId: string,
  ): Promise<EcosystemCampaignHumanStatusV1> {
    const portfolio = await this.access.portfolio(authorization);
    const target = portfolio.items.find((item) => item.campaignId === campaignId);
    if (!target) throw new NotFoundException('Campaign was not found in the authorized workspace');
    return this.describeCampaign(target.tenantId, target.campaignId, target.executionPlanId);
  }

  async advanceSafe(
    authorization: string | undefined,
    campaignId: string,
  ) {
    const portfolio = await this.access.portfolio(authorization);
    const target = portfolio.items.find((item) => item.campaignId === campaignId);
    if (!target) throw new NotFoundException('Campaign was not found in the authorized workspace');

    const status = await this.packages.get(target.tenantId, campaignId);
    const next = status.next_action;

    if (next === 'RESOLVE_META_TARGET') {
      const selected = await this.connections.selectedExecutionTarget(target.tenantId);
      await this.access.bindExecutionTarget(
        authorization,
        target.tenantId,
        campaignId,
        status.execution_plan.execution_plan_id,
        selected.connectionId,
        selected.adAccountId,
      );
      return {
        actionStatus: 'SAFE_STEP_COMPLETED',
        headline: 'O alvo da Meta foi resolvido automaticamente.',
        simpleMessage: 'Usei a conta de anúncios já selecionada no ambiente. Você não precisou informar nenhum ID técnico.',
        nextStep: 'Vou seguir até o próximo ponto que exija revisão ou aprovação humana.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária agora.',
        boundaries: this.boundaries(),
      };
    }

    if (next === 'REQUEST_EXECUTION_PLAN_APPROVAL') {
      const approval = await this.access.requestPlanApproval(
        authorization,
        target.tenantId,
        campaignId,
        status.execution_plan.execution_plan_id,
      );
      return {
        actionStatus: 'SAFE_STEP_COMPLETED',
        headline: 'O Gerador terminou o plano e a aprovação já está pronta para você.',
        simpleMessage: 'Nenhuma campanha foi publicada. Apenas preparei internamente a decisão humana que vem antes de qualquer efeito externo.',
        nextStep: 'Revise e aprove ou rejeite o plano quando quiser continuar.',
        userActionRequired: true,
        userAction: 'Aprovar ou rejeitar o plano de campanha.',
        technicalDetails: {
          approvalId: approval.approvalId,
          approvalStatus: approval.status,
        },
        boundaries: this.boundaries(),
      };
    }

    if (next === 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE') {
      return {
        actionStatus: 'USER_DECISION_REQUIRED',
        headline: 'O criativo precisa da sua revisão.',
        simpleMessage: 'O sistema não vai fingir que viu ou aprovou uma peça visual por você.',
        nextStep: 'Revise a peça e confirme se ela está fiel ao que foi aprovado.',
        userActionRequired: true,
        userAction: 'Aprovar ou pedir ajuste no criativo.',
        boundaries: this.boundaries(),
      };
    }

    if (next === 'DECIDE_EXECUTION_PLAN_APPROVAL') {
      return {
        actionStatus: 'USER_DECISION_REQUIRED',
        headline: 'O plano está aguardando sua decisão.',
        simpleMessage: 'Todo o trabalho técnico anterior já foi feito. Agora só falta a decisão humana de aprovar ou rejeitar este plano.',
        nextStep: 'Aprove ou rejeite o plano. Isso ainda não publica nem ativa campanha.',
        userActionRequired: true,
        userAction: 'Aprovar ou rejeitar o plano de campanha.',
        boundaries: this.boundaries(),
      };
    }

    return {
      actionStatus: 'EXTERNAL_GATE_REACHED',
      headline: 'Chegamos ao limite da automação segura.',
      simpleMessage: 'O ecossistema concluiu o que podia fazer sem autorização de efeito externo.',
      nextStep: 'Qualquer criação, publicação, ativação ou ação financeira continua exigindo autorização específica.',
      userActionRequired: true,
      userAction: 'Decidir se deseja avançar pelo gate externo apropriado.',
      boundaries: this.boundaries(),
    };
  }

  private async describeCampaign(
    tenantId: string,
    campaignId: string,
    fallbackExecutionPlanId: string,
  ): Promise<EcosystemCampaignHumanStatusV1> {
    let packageStatus: Awaited<ReturnType<CampaignPackageStatusService['get']>> | null = null;
    try {
      packageStatus = await this.packages.get(tenantId, campaignId);
    } catch {
      return {
        tenantId,
        campaignId,
        activeModule: 'contexto_ads',
        stage: 'CONTEXT_REQUIRED',
        progressPercent: 20,
        headline: 'A estratégia ainda precisa ser concluída no Contexto Ads.',
        simpleMessage: 'Ainda não existe um pacote de campanha completo para o Gerador trabalhar.',
        whatSystemDid: 'Preservei o que já existe e não inventei informações para preencher lacunas.',
        nextStep: 'Concluir apenas as informações realmente necessárias no Contexto Ads.',
        userActionRequired: true,
        userAction: 'Responder às pendências materiais do Contexto Ads.',
        technicalDetails: {
          executionPlanId: fallbackExecutionPlanId ?? null,
          packageNextAction: null,
          creativeStatus: null,
          targetBindingStatus: null,
          planApprovalStatus: null,
          trackingRegistered: false,
          analystDecision: null,
          analystOperationalState: null,
        },
        boundaries: this.boundaries(),
      };
    }

    const tracking = await this.tracking.find(tenantId, campaignId);
    const latest = await this.analyst.latest(tenantId, campaignId);
    const brief = latest.analysis ? this.presenter.present(latest.analysis) : null;

    if (tracking && latest.analysis?.requiresApproval) {
      return this.humanStatus(packageStatus, tracking !== null, brief, {
        activeModule: 'user',
        stage: 'ANALYST_DECISION',
        progressPercent: 100,
        headline: 'O Analista encontrou uma decisão que merece sua aprovação.',
        simpleMessage: brief?.simpleMessage ?? 'Existe uma recomendação pronta para sua decisão.',
        whatSystemDid: 'O Analista coletou os dados, comparou o histórico e preparou uma recomendação sem executá-la.',
        nextStep: brief?.nextStep ?? 'Revise a recomendação antes de qualquer alteração.',
        userActionRequired: true,
        userAction: brief?.userAction ?? 'Aprovar ou rejeitar a recomendação.',
      });
    }

    if (tracking && brief) {
      return this.humanStatus(packageStatus, true, brief, {
        activeModule: 'analyst',
        stage: 'MONITORING',
        progressPercent: 100,
        headline: brief.situation,
        simpleMessage: brief.simpleMessage,
        whatSystemDid: 'A campanha foi vinculada ao Analista e está sendo acompanhada automaticamente.',
        nextStep: brief.nextStep,
        userActionRequired: brief.userActionRequired,
        userAction: brief.userAction,
      });
    }

    if (tracking) {
      return this.humanStatus(packageStatus, true, brief, {
        activeModule: 'analyst',
        stage: 'ANALYSIS_WAITING',
        progressPercent: 90,
        headline: 'A campanha já chegou ao Analista.',
        simpleMessage: 'O vínculo com a campanha real está pronto; falta apenas uma janela de dados suficiente para uma análise útil.',
        whatSystemDid: 'O Gerador concluiu o vínculo técnico e o Analista já sabe qual campanha acompanhar.',
        nextStep: 'A coleta automática fará a análise quando houver dados disponíveis.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária agora.',
      });
    }

    if (packageStatus.creative?.status !== 'approved') {
      return this.humanStatus(packageStatus, false, brief, {
        activeModule: 'user',
        stage: 'CREATIVE_REVIEW',
        progressPercent: 45,
        headline: 'A estratégia já chegou ao Gerador; falta revisar o criativo.',
        simpleMessage: 'Os dados da campanha estão preservados. O sistema parou porque a fidelidade visual precisa de confirmação real.',
        whatSystemDid: 'O Contexto Ads entregou a estratégia e o Gerador preparou o pacote técnico sem publicar nada.',
        nextStep: 'Revise o criativo e confirme se está correto.',
        userActionRequired: true,
        userAction: 'Aprovar ou pedir ajuste no criativo.',
      });
    }

    if (packageStatus.execution_plan.target_binding_status !== 'BOUND') {
      return this.humanStatus(packageStatus, false, brief, {
        activeModule: 'generator',
        stage: 'TARGET_RESOLUTION',
        progressPercent: 55,
        headline: 'O Gerador está resolvendo onde a campanha será criada.',
        simpleMessage: 'Conta de anúncios e ativos técnicos podem ser resolvidos pelo sistema a partir da conexão já selecionada.',
        whatSystemDid: 'A estratégia e o criativo já estão prontos; nenhum dado será pedido novamente se o sistema já puder recuperá-lo.',
        nextStep: 'Executar o próximo passo seguro para resolver o alvo Meta.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária agora.',
      });
    }

    if (packageStatus.next_action === 'REQUEST_EXECUTION_PLAN_APPROVAL') {
      return this.humanStatus(packageStatus, false, brief, {
        activeModule: 'generator',
        stage: 'PLAN_APPROVAL_PREPARATION',
        progressPercent: 65,
        headline: 'O Gerador terminou o plano técnico.',
        simpleMessage: 'O plano está pronto e o sistema pode abrir a aprovação para você sem publicar nada.',
        whatSystemDid: 'Estruturei campanha, orçamento, ativos e plano de execução com base na estratégia aprovada.',
        nextStep: 'Executar o próximo passo seguro para preparar a aprovação.',
        userActionRequired: false,
        userAction: 'Nenhuma ação sua é necessária até a aprovação ser aberta.',
      });
    }

    if (packageStatus.next_action === 'DECIDE_EXECUTION_PLAN_APPROVAL') {
      return this.humanStatus(packageStatus, false, brief, {
        activeModule: 'user',
        stage: 'PLAN_APPROVAL_REQUIRED',
        progressPercent: 70,
        headline: 'O plano está pronto para sua decisão.',
        simpleMessage: 'Você só precisa dizer se aprova ou rejeita. Isso ainda não coloca campanha no ar.',
        whatSystemDid: 'O Gerador concluiu todas as etapas internas anteriores à decisão humana.',
        nextStep: 'Aprovar ou rejeitar o plano.',
        userActionRequired: true,
        userAction: 'Aprovar ou rejeitar o plano de campanha.',
      });
    }

    return this.humanStatus(packageStatus, false, brief, {
      activeModule: 'user',
      stage: 'EXTERNAL_EXECUTION_GATE',
      progressPercent: 80,
      headline: 'A preparação interna terminou.',
      simpleMessage: 'Chegamos ao ponto em que qualquer avanço pode produzir efeito externo. O sistema parou corretamente.',
      whatSystemDid: 'Contexto Ads e Gerador concluíram a preparação segura e preservaram todas as aprovações e versões.',
      nextStep: 'Só avançar mediante a autorização externa específica prevista para esta etapa.',
      userActionRequired: true,
      userAction: 'Decidir se deseja avançar pelo gate externo.',
    });
  }

  private humanStatus(
    packageStatus: Awaited<ReturnType<CampaignPackageStatusService['get']>>,
    trackingRegistered: boolean,
    brief: ReturnType<AnalystPresenter['present']> | null,
    human: Pick<EcosystemCampaignHumanStatusV1,
      'activeModule' | 'stage' | 'progressPercent' | 'headline' | 'simpleMessage'
      | 'whatSystemDid' | 'nextStep' | 'userActionRequired' | 'userAction'>,
  ): EcosystemCampaignHumanStatusV1 {
    return {
      tenantId: packageStatus.context ? packageStatus.resolved_context?.tenant_id ?? '' : '',
      campaignId: packageStatus.campaign_id,
      ...human,
      technicalDetails: {
        executionPlanId: packageStatus.execution_plan.execution_plan_id ?? null,
        packageNextAction: packageStatus.next_action ?? null,
        creativeStatus: packageStatus.creative?.status ?? null,
        targetBindingStatus: packageStatus.execution_plan.target_binding_status ?? null,
        planApprovalStatus: packageStatus.plan_approval?.status ?? null,
        trackingRegistered,
        analystDecision: brief?.decision ?? null,
        analystOperationalState: brief?.operationalState ?? null,
      },
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
