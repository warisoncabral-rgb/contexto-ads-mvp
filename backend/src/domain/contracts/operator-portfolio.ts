import { OperatorRole } from './operator-access';
import { OperationalReadinessStatus } from './operational-readiness';

export interface OperatorPortfolioItemV1 {
  tenantId: string;
  tenantDisplayName: string;
  role: OperatorRole;
  campaignId: string;
  executionPlanId: string;
  planStatus: 'draft' | 'pending' | 'blocked' | 'ready_for_approval' | 'approved' | 'executing';
  readinessStatus: OperationalReadinessStatus | 'not_evaluated';
  headline: string;
  nextAction: string;
  blockerCount: number;
  maximumPlannedSpendMinor: number;
  currency: string;
  updatedAt: string;
}

export interface OperatorPortfolioV1 {
  items: OperatorPortfolioItemV1[];
  summary: {
    authorizedTenantCount: number;
    campaignCount: number;
    blockedCount: number;
    actionRequiredCount: number;
    readyCount: number;
    notEvaluatedCount: number;
  };
  boundaries: {
    tenantAccessDerivedFromMembership: true;
    latestPlanPerCampaign: true;
    priorityRuleIsDeterministic: true;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
