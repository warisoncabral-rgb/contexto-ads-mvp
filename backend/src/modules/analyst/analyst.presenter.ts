import { AnalystAnalysisV1 } from '../../domain/contracts/analyst';
import { AnalystUserBriefV1 } from '../../domain/contracts/analyst-user-brief';

const DECISION_TEXT: Record<AnalystAnalysisV1['recommendedAction'], string> = {
  MANTER: 'Mantenha a campanha como está.',
  AGUARDAR: 'Não faça alterações agora. Aguarde mais dados.',
  OBSERVAR: 'Mantenha a campanha e acompanhe este sinal com atenção.',
  AJUSTAR: 'Revise a campanha e faça um ajuste específico antes de continuar.',
  PAUSAR: 'Considere pausar a campanha para evitar desperdício ou risco adicional.',
  DUPLICAR: 'Considere duplicar a estrutura vencedora de forma controlada.',
  ESCALAR: 'Considere escalar a campanha gradualmente.',
  AUMENTAR_VERBA: 'Considere aumentar o orçamento de forma gradual e supervisionada.',
  REDUZIR_VERBA: 'Considere reduzir a exposição ou o orçamento de forma controlada.',
  GERAR_NOVA_VARIACAO: 'Crie uma nova variação para testar a hipótese identificada.',
  REAVALIAR_ESTRATEGIA: 'Retorne ao Contexto Ads para reavaliar a estratégia antes de alterar a execução.',
};

const HEALTH_TEXT: Record<AnalystAnalysisV1['healthStatus'], string> = {
  HEALTHY: 'A campanha está saudável no momento.',
  OBSERVATION: 'A campanha está em observação.',
  ATTENTION: 'Existe um sinal que merece atenção.',
  INTERVENTION_RECOMMENDED: 'Há evidência suficiente para recomendar uma intervenção.',
  OPERATIONAL_PROBLEM: 'Existe um problema operacional que precisa ser resolvido antes da otimização.',
  INSUFFICIENT_DATA: 'Ainda não há dados suficientes para uma conclusão segura.',
};

export class AnalystPresenter {
  present(analysis: AnalystAnalysisV1): AnalystUserBriefV1 {
    const confidenceLabel = analysis.confidence === 'high'
      ? 'Alta'
      : analysis.confidence === 'moderate'
        ? 'Moderada'
        : 'Baixa';
    const urgencyLabel = analysis.urgency === 'high'
      ? 'Ação recomendada'
      : analysis.urgency === 'medium'
        ? 'Acompanhar'
        : 'Sem urgência';
    const recommendation = DECISION_TEXT[analysis.recommendedAction];
    const userAction = this.userAction(analysis);
    const situation = HEALTH_TEXT[analysis.healthStatus];
    const primaryEvidence = this.primaryEvidence(analysis);
    const simpleMessage = [situation, recommendation, userAction].filter(Boolean).join(' ');

    return {
      locale: 'pt-BR',
      situation,
      primaryEvidence,
      interpretation: this.trimSentence(analysis.diagnosis, 240),
      recommendation,
      nextStep: this.nextStep(analysis),
      confidence: {
        level: analysis.confidence,
        label: confidenceLabel,
      },
      urgency: {
        level: analysis.urgency,
        label: urgencyLabel,
      },
      nextReviewAt: analysis.nextReview,
      userActionRequired: analysis.requiresApproval,
      userAction,
      healthStatus: analysis.healthStatus,
      decision: analysis.recommendedAction,
      simpleMessage,
      technicalDetailsAvailable: true,
    };
  }

  private primaryEvidence(analysis: AnalystAnalysisV1): string {
    const preferred = analysis.evidence
      .filter((item) => !item.startsWith('previous_snapshot_id='))
      .slice(0, 3)
      .map((item) => this.humanizeEvidence(item));
    if (preferred.length > 0) return preferred.join('; ');
    return this.trimSentence(analysis.observation, 220);
  }

  private humanizeEvidence(value: string): string {
    const [key, raw = ''] = value.split('=', 2);
    const labels: Record<string, string> = {
      campaign_status: 'status',
      campaign_age_hours: 'tempo de campanha',
      impressions: 'impressões',
      spend_minor: 'investimento',
      results: 'resultados',
      clicks: 'cliques',
      hours_since_last_change: 'tempo desde a última alteração',
    };
    const label = labels[key] ?? key.replaceAll('_', ' ');
    if (key === 'spend_minor') {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return `${label}: ${(numeric / 100).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} na moeda da conta`;
      }
    }
    if (key.endsWith('_hours')) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return `${label}: ${Math.round(numeric)} h`;
    }
    return `${label}: ${raw}`;
  }

  private nextStep(analysis: AnalystAnalysisV1): string {
    if (analysis.healthStatus === 'INSUFFICIENT_DATA') {
      return 'Aguarde a próxima janela de análise. Não altere público, criativo ou orçamento antes disso.';
    }
    if (analysis.healthStatus === 'OPERATIONAL_PROBLEM') {
      return 'Corrija primeiro o bloqueio operacional. Só depois reavalie desempenho e estratégia.';
    }
    if (analysis.requiresApproval) {
      return 'Revise a recomendação e aprove ou rejeite a alteração antes de qualquer execução.';
    }
    if (analysis.recommendedAction === 'MANTER') {
      return 'Nenhuma alteração é necessária agora. Continue o acompanhamento na próxima janela.';
    }
    if (analysis.recommendedAction === 'OBSERVAR') {
      return 'Não altere a campanha agora. Verifique se o sinal se repete no próximo ciclo.';
    }
    return 'Siga a recomendação somente pelo fluxo oficial do Ecossistema Ads.';
  }

  private userAction(analysis: AnalystAnalysisV1): string {
    if (analysis.requiresApproval) {
      return 'Sua decisão é necessária: aprovar ou rejeitar a recomendação.';
    }
    if (analysis.healthStatus === 'INSUFFICIENT_DATA') {
      return 'Nenhuma ação sua é necessária agora.';
    }
    if (analysis.recommendedAction === 'MANTER' || analysis.recommendedAction === 'OBSERVAR') {
      return 'Nenhuma alteração sua é necessária agora.';
    }
    return 'Acompanhe a próxima revisão indicada pelo Analista.';
  }

  private trimSentence(value: string, limit: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }
}
