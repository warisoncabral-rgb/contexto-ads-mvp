import {
  AnalystConfidence,
  AnalystHealthStatus,
  AnalystRecommendedAction,
} from './analyst';

export type AnalystUserOperationalState =
  | 'RUNNING'
  | 'PAUSED'
  | 'BLOCKED'
  | 'UNKNOWN';

export interface AnalystUserBriefV1 {
  locale: 'pt-BR';
  operationalState: AnalystUserOperationalState;
  situation: string;
  primaryEvidence: string;
  interpretation: string;
  recommendation: string;
  nextStep: string;
  confidence: {
    level: AnalystConfidence;
    label: 'Baixa' | 'Moderada' | 'Alta';
  };
  urgency: {
    level: 'low' | 'medium' | 'high';
    label: 'Sem urgência' | 'Acompanhar' | 'Ação recomendada';
  };
  nextReviewAt: string;
  userActionRequired: boolean;
  userAction: string;
  healthStatus: AnalystHealthStatus;
  decision: AnalystRecommendedAction;
  simpleMessage: string;
  technicalDetailsAvailable: true;
}
