import { AnalystRecommendedAction } from './analyst';

export type AnalystRecommendationDecision = 'approve' | 'reject';
export type AnalystRecommendationHandoffTarget =
  | 'generator'
  | 'contexto_ads'
  | 'operational_review';

export interface AnalystRecommendationDecisionV1 {
  actionStatus:
    | 'APPROVED_RECOMMENDATION'
    | 'REJECTED_RECOMMENDATION'
    | 'NO_APPROVAL_REQUIRED'
    | 'NO_RECOMMENDATION';
  tenantId: string;
  campaignId: string;
  analysisId: string | null;
  recommendedAction: AnalystRecommendedAction | null;
  decision: AnalystRecommendationDecision | null;
  reason: string | null;
  handoffTarget: AnalystRecommendationHandoffTarget | null;
  decidedBy: string | null;
  decidedAt: string | null;
  userMessage: string;
  nextStep: string;
  boundaries: {
    decisionIsExecutionAuthorization: false;
    executionAuthorized: false;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    recommendationAutoExecuted: false;
    financialActionAuthorized: false;
  };
}

export type AnalystAlertLevel = 'none' | 'info' | 'watch' | 'action_required' | 'critical';

export interface AnalystEssentialAlertV1 {
  actionStatus: 'OK' | 'NO_ANALYSIS';
  level: AnalystAlertLevel;
  title: string;
  message: string;
  nextStep: string;
  userActionRequired: boolean;
  analysisId: string | null;
  campaignId: string;
  nextReviewAt: string | null;
  boundaries: {
    alertIsExecutionCommand: false;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    recommendationAutoExecuted: false;
  };
}
