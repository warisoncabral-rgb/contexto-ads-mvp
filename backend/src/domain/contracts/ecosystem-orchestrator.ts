export type EcosystemActiveModule = 'contexto_ads' | 'generator' | 'analyst' | 'user';

export type EcosystemStage =
  | 'CONTEXT_REQUIRED'
  | 'CREATIVE_REVIEW'
  | 'TARGET_RESOLUTION'
  | 'PLAN_APPROVAL_PREPARATION'
  | 'PLAN_APPROVAL_REQUIRED'
  | 'EXTERNAL_EXECUTION_GATE'
  | 'ANALYSIS_WAITING'
  | 'ANALYST_DECISION'
  | 'MONITORING'
  | 'BLOCKED';

export interface EcosystemCampaignHumanStatusV1 {
  tenantId: string;
  campaignId: string;
  activeModule: EcosystemActiveModule;
  stage: EcosystemStage;
  progressPercent: number;
  headline: string;
  simpleMessage: string;
  whatSystemDid: string;
  nextStep: string;
  userActionRequired: boolean;
  userAction: string;
  technicalDetails: {
    executionPlanId: string | null;
    packageNextAction: string | null;
    creativeStatus: string | null;
    targetBindingStatus: string | null;
    planApprovalStatus: string | null;
    trackingRegistered: boolean;
    analystDecision: string | null;
    analystOperationalState: string | null;
  };
  boundaries: {
    publicationAuthorized: false;
    activationAuthorized: false;
    externalWritesAllowed: false;
    financialActionAuthorized: false;
    recommendationAutoExecuted: false;
  };
}

export interface EcosystemOverviewV1 {
  actionStatus: 'OK';
  headline: string;
  simpleMessage: string;
  userActionRequired: boolean;
  campaigns: EcosystemCampaignHumanStatusV1[];
  summary: {
    campaignCount: number;
    monitoringCount: number;
    userActionCount: number;
    blockedCount: number;
  };
  boundaries: {
    publicationAuthorized: false;
    activationAuthorized: false;
    externalWritesAllowed: false;
    financialActionAuthorized: false;
    recommendationAutoExecuted: false;
  };
}
