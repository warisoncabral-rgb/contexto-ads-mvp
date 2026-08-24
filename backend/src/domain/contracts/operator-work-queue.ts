import { OperatorRole } from './operator-access';

export type OperatorWorkOwner = 'system' | 'operator' | 'meta_environment';
export type OperatorWorkPriority = 'critical' | 'high' | 'normal';
export type OperatorWorkChangeKind = 'entered' | 'worsened' | 'improved' | 'unchanged' | 'resolved';

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

export interface OperatorWorkQueueSourceDecisionV1 {
  source: 'campaign_plans' | 'operational_readiness' | 'execution_lifecycle' | 'delivery_metrics';
  status: 'included' | 'deferred' | 'ignored';
  reason: string;
}

export interface OperatorWorkQueueChangeV1 {
  workItemId: string;
  tenantId: string;
  tenantDisplayName: string;
  campaignId: string;
  executionPlanId: string;
  blockerCode: string;
  kind: OperatorWorkChangeKind;
  previousPriority: OperatorWorkPriority | null;
  currentPriority: OperatorWorkPriority | null;
  meaning: string;
  evidenceRefs: string[];
  previousQueueDate: string | null;
  currentQueueDate: string;
}

export interface OperatorWorkQueueSnapshotComparisonV1 {
  baselineAvailable: boolean;
  previousQueueDate: string | null;
  changes: OperatorWorkQueueChangeV1[];
}

export interface OperatorWorkQueueSnapshotV1 {
  snapshotId: string;
  tenantId: string;
  queueDate: string;
  calendarBasis: 'UTC';
  snapshotHash: string;
  itemCount: number;
  sourceDecisions: OperatorWorkQueueSourceDecisionV1[];
  comparison?: OperatorWorkQueueSnapshotComparisonV1;
  generatedAt: string;
}

export interface OperatorWorkQueueStoredSnapshotV1 extends OperatorWorkQueueSnapshotV1 {
  items: OperatorWorkItemV1[];
}

export interface OperatorWorkQueueV1 {
  items: OperatorWorkItemV1[];
  snapshots: OperatorWorkQueueSnapshotV1[];
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
    dailySnapshotsPersisted: true;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
