export type AnalystConfidence = 'low' | 'moderate' | 'high';

export type AnalystHealthStatus =
  | 'HEALTHY'
  | 'OBSERVATION'
  | 'ATTENTION'
  | 'INTERVENTION_RECOMMENDED'
  | 'OPERATIONAL_PROBLEM'
  | 'INSUFFICIENT_DATA';

export type AnalystRecommendedAction =
  | 'MANTER'
  | 'AGUARDAR'
  | 'OBSERVAR'
  | 'AJUSTAR'
  | 'PAUSAR'
  | 'DUPLICAR'
  | 'ESCALAR'
  | 'AUMENTAR_VERBA'
  | 'REDUZIR_VERBA'
  | 'GERAR_NOVA_VARIACAO'
  | 'REAVALIAR_ESTRATEGIA';

export interface AnalystMetricsV1 {
  impressions: number;
  reach: number;
  spendMinor: number;
  results: number;
  clicks: number;
  frequency?: number;
  ctr?: number;
  cpcMinor?: number;
  costPerResultMinor?: number;
}

export interface AnalystSnapshotInputV1 {
  periodStart: string;
  periodEnd: string;
  campaignStatus: string;
  campaignAgeHours: number;
  hoursSinceLastChange?: number;
  source?: 'meta_readonly' | 'manual_shadow' | 'historical_import';
  metrics: AnalystMetricsV1;
}

export interface AnalystBusinessConstraintsV1 {
  targetCostPerResultMinor?: number;
  maximumDailyBudgetMinor?: number;
  minimumObservationHours?: number;
}

export interface AnalystAnalyzeInputV1 {
  clientContext?: Record<string, unknown>;
  campaignStrategy?: Record<string, unknown>;
  campaignConfiguration?: Record<string, unknown>;
  campaignStatus?: Record<string, unknown>;
  changeHistory?: Array<Record<string, unknown>>;
  approvedActions?: Array<Record<string, unknown>>;
  businessConstraints?: AnalystBusinessConstraintsV1;
  snapshot: AnalystSnapshotInputV1;
}

export interface AnalystSnapshotV1 {
  snapshotId: string;
  snapshotHash: string;
  tenantId: string;
  campaignId: string;
  periodStart: string;
  periodEnd: string;
  campaignStatus: string;
  campaignAgeHours: number;
  hoursSinceLastChange?: number;
  source: 'meta_readonly' | 'manual_shadow' | 'historical_import';
  metrics: AnalystMetricsV1;
  collectedAt: string;
}

export interface AnalystAnalysisV1 {
  analysisId: string;
  tenantId: string;
  campaignId: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  observation: string;
  diagnosis: string;
  hypotheses: string[];
  confidence: AnalystConfidence;
  healthStatus: AnalystHealthStatus;
  recommendedAction: AnalystRecommendedAction;
  reason: string;
  expectedImpact: 'none' | 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  urgency: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  nextReview: string;
  learning: string | null;
  dataMaturity: 'insufficient' | 'emerging' | 'mature';
  evidence: string[];
  generatedAt: string;
  boundaries: {
    shadowMode: true;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    recommendationAutoExecuted: false;
    financialActionAuthorized: false;
  };
}

export interface AnalystLatestV1 {
  snapshot: AnalystSnapshotV1 | null;
  analysis: AnalystAnalysisV1 | null;
}
