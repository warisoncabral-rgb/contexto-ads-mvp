import { ExecutionSimulationCheck } from './execution-simulation';

export type OperationalReadinessStatus =
  | 'blocked'
  | 'action_required'
  | 'ready_for_executor_validation';

export interface OperationalBlockerV1 {
  code: ExecutionSimulationCheck['key'];
  owner: 'system' | 'operator' | 'meta_environment';
  meaning: string;
  nextAction: string;
  evidenceRefs: string[];
}

export interface OperationalReadinessDecisionV1 {
  readinessDecisionId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  planHash: string;
  simulationId: string;
  decisionHash: string;
  status: OperationalReadinessStatus;
  headline: string;
  plainLanguageSummary: string;
  decisionBasis: Array<{
    decision: string;
    why: string;
    evidenceRefs: string[];
  }>;
  blockers: OperationalBlockerV1[];
  nextAction: string;
  progress: {
    campaignPreparation: 'complete' | 'incomplete';
    metaEnvironmentValidation: 'complete' | 'pending';
    creativeApproval: 'complete' | 'pending';
    humanPlanApproval: 'complete' | 'pending';
    executorValidation: 'pending';
    publication: 'not_started';
    activation: 'not_started';
    delivery: 'not_started';
  };
  financialScope: {
    currency: string;
    maximumPlannedSpendMinor: number;
    calculation: string;
  };
  autonomy: {
    level: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
    humanApprovalRequired: boolean;
  };
  boundaries: {
    campaignPublished: false;
    campaignActive: false;
    campaignDelivering: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
