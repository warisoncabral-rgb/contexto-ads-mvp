import { OperatorRole } from './operator-access';

export type OperatorWorkOwner = 'system' | 'operator' | 'meta_environment';
export type OperatorWorkPriority = 'critical' | 'high' | 'normal';

export interface OperatorWorkItemV1 {
  workItemId: string;
  tenantId: string;
  tenantDisplayName: string;
  role: OperatorRole;
  campaignId: string;
  executionPlanId: string;
  source: 'operational_blocker' | 'readiness_not_evaluated';
  blockerCode: string;
  owner: OperatorWorkOwner;
  priority: OperatorWorkPriority;
  meaning: string;
  nextAction: string;
  evidenceRefs: string[];
  observedAt: string;
}

export interface OperatorWorkQueueV1 {
  items: OperatorWorkItemV1[];
  summary: {
    authorizedTenantCount: number;
    pendingItemCount: number;
    criticalCount: number;
    operatorCount: number;
    systemCount: number;
    metaEnvironmentCount: number;
  };
  boundaries: {
    derivedFromCurrentReadiness: true;
    tenantAccessDerivedFromMembership: true;
    priorityRuleIsDeterministic: true;
    deadlinesFabricated: false;
    completionInferred: false;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
