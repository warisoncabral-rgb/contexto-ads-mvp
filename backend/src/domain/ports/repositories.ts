import { MetaConnection, MetaAssetBinding } from '../contracts/meta-connection';
import { CapabilityRecord } from '../contracts/capability';
import { AuditEvent } from '../contracts/audit-event';
import { ReadinessSnapshot, ReadOnlySmokeTestReport } from '../contracts/readiness';
import { MetaOAuthAttempt } from '../contracts/meta-oauth-attempt';
import {
  CampaignContextPackageV1,
  UnversionedCampaignContextPackageV1,
} from '../contracts/campaign-context';
import { ExecutionPlanV1 } from '../contracts/execution-plan';
import { ApprovalV1 } from '../contracts/approval';
import { ExecutionSimulationReportV1 } from '../contracts/execution-simulation';
import {
  CreativePackageV1,
  UnversionedCreativePackageV1,
} from '../contracts/creative-package';
import { OperationalReadinessDecisionV1 } from '../contracts/operational-readiness';
import { ExecutionManifestV1 } from '../contracts/execution-manifest';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightV1,
} from '../contracts/execution-authorization';
import {
  KillSwitchScope,
  KillSwitchStateV1,
  UnversionedKillSwitchStateV1,
} from '../contracts/kill-switch';
import { MetaWriteValidationProtocolV1 } from '../contracts/meta-write-validation';
import { OperatorTenantMembershipV1 } from '../contracts/operator-access';

export interface MetaConnectionRepository {
  save(connection: MetaConnection): Promise<void>;
  findById(tenantId: string, connectionId: string): Promise<MetaConnection | null>;
  replaceBindings(
    tenantId: string,
    connectionId: string,
    bindings: MetaAssetBinding[],
  ): Promise<void>;
  listBindings(tenantId: string, connectionId: string): Promise<MetaAssetBinding[]>;
}
export interface CapabilityRepository {
  replaceForConnection(tenantId: string, connectionId: string, capabilities: CapabilityRecord[]): Promise<void>;
  listForConnection(tenantId: string, connectionId: string): Promise<CapabilityRecord[]>;
}
export interface AuditRepository { append(event: AuditEvent): Promise<void>; }
export interface ReadinessRepository {
  save(snapshot: ReadinessSnapshot): Promise<void>;
  latestForConnection(tenantId: string, connectionId: string): Promise<ReadinessSnapshot | null>;
}
export interface SmokeTestReportRepository {
  save(report: ReadOnlySmokeTestReport): Promise<void>;
  latestForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadOnlySmokeTestReport | null>;
}

export interface CampaignContextRepository {
  create(context: CampaignContextPackageV1, event?: AuditEvent): Promise<void>;
  appendNext(
    context: UnversionedCampaignContextPackageV1,
    event?: AuditEvent,
  ): Promise<CampaignContextPackageV1 | null>;
  latest(
    tenantId: string,
    campaignId: string,
  ): Promise<CampaignContextPackageV1 | null>;
  findVersion(
    tenantId: string,
    campaignId: string,
    version: number,
  ): Promise<CampaignContextPackageV1 | null>;
}

export interface OperatorCampaignContextSelectionRepository {
  listLatestForTenant(tenantId: string): Promise<CampaignContextPackageV1[]>;
}

export interface ExecutionPlanRepository {
  saveIdempotent(plan: ExecutionPlanV1): Promise<ExecutionPlanV1>;
  latest(tenantId: string, campaignId: string): Promise<ExecutionPlanV1 | null>;
  findById(tenantId: string, executionPlanId: string): Promise<ExecutionPlanV1 | null>;
}

export interface OperatorPlanSelectionRepository {
  listLatestForTenant(tenantId: string): Promise<ExecutionPlanV1[]>;
  findById(tenantId: string, executionPlanId: string): Promise<ExecutionPlanV1 | null>;
}

export interface ApprovalRepository {
  request(approval: ApprovalV1, event: AuditEvent): Promise<ApprovalV1>;
  findById(tenantId: string, approvalId: string): Promise<ApprovalV1 | null>;
  approveIfCurrent(
    tenantId: string,
    approvalId: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null>;
  transition(
    tenantId: string,
    approvalId: string,
    fromStatuses: ApprovalV1['status'][],
    toStatus: ApprovalV1['status'],
    updatedAt: string,
    decisionReason: string | undefined,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null>;
  expire(
    tenantId: string,
    approvalId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null>;
  invalidateIfStale(
    tenantId: string,
    approvalId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null>;
  invalidateForCampaignExceptHash(
    tenantId: string,
    campaignId: string,
    currentPlanHash: string,
    now: string,
  ): Promise<number>;
}

export interface ExecutionSimulationRepository {
  save(report: ExecutionSimulationReportV1): Promise<void>;
  findById(
    tenantId: string,
    executionPlanId: string,
    simulationId: string,
  ): Promise<ExecutionSimulationReportV1 | null>;
  latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionSimulationReportV1 | null>;
}

export interface ExecutionManifestRepository {
  saveIdempotent(
    manifest: ExecutionManifestV1,
    event: AuditEvent,
  ): Promise<ExecutionManifestV1>;
  latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionManifestV1 | null>;
  findById(
    tenantId: string,
    executionManifestId: string,
  ): Promise<ExecutionManifestV1 | null>;
}

export interface ExecutionAuthorizationRepository {
  request(
    authorization: ExecutionAuthorizationV1,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1>;
  findById(
    tenantId: string,
    executionAuthorizationId: string,
  ): Promise<ExecutionAuthorizationV1 | null>;
  approveIfCurrent(
    tenantId: string,
    executionAuthorizationId: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null>;
  transition(
    tenantId: string,
    executionAuthorizationId: string,
    fromStatuses: ExecutionAuthorizationV1['status'][],
    toStatus: ExecutionAuthorizationV1['status'],
    updatedAt: string,
    reason: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null>;
  expireOrInvalidate(
    tenantId: string,
    executionAuthorizationId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null>;
  savePreflightIdempotent(
    preflight: ExecutionPreflightV1,
    event: AuditEvent,
  ): Promise<ExecutionPreflightV1>;
}

export interface KillSwitchRepository {
  appendNext(
    state: UnversionedKillSwitchStateV1,
    event: AuditEvent,
  ): Promise<KillSwitchStateV1>;
  latest(
    tenantId: string,
    scope: KillSwitchScope,
    campaignId?: string,
  ): Promise<KillSwitchStateV1 | null>;
}

export interface MetaWriteValidationProtocolRepository {
  saveIdempotent(
    protocol: MetaWriteValidationProtocolV1,
    event: AuditEvent,
  ): Promise<MetaWriteValidationProtocolV1>;
  latestForManifest(
    tenantId: string,
    executionManifestId: string,
  ): Promise<MetaWriteValidationProtocolV1 | null>;
}

export interface OperatorTenantMembershipRepository {
  listActiveForSubject(operatorSubject: string): Promise<OperatorTenantMembershipV1[]>;
}

export interface CreativePackageRepository {
  appendNext(
    creativePackage: UnversionedCreativePackageV1,
    event: AuditEvent,
  ): Promise<CreativePackageV1 | null>;
  latest(tenantId: string, campaignId: string): Promise<CreativePackageV1 | null>;
  findVersion(
    tenantId: string,
    campaignId: string,
    version: number,
  ): Promise<CreativePackageV1 | null>;
  approveLatest(
    tenantId: string,
    campaignId: string,
    version: number,
    contentHash: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<CreativePackageV1 | null>;
}

export interface OperationalReadinessRepository {
  saveIdempotent(
    decision: OperationalReadinessDecisionV1,
    event: AuditEvent,
  ): Promise<OperationalReadinessDecisionV1>;
  latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<OperationalReadinessDecisionV1 | null>;
}

export interface MetaOAuthAttemptStore {
  replaceActive(attempt: MetaOAuthAttempt): Promise<void>;
  consumeActive(stateHash: string): Promise<MetaOAuthAttempt | null>;
  recordCredentialRevocationPending(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    createdAt: string,
  ): Promise<void>;
}

export interface MetaConnectionStore
  extends Pick<MetaConnectionRepository, 'save' | 'findById'> {
  markConnected(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    updatedAt: string,
  ): Promise<boolean>;
}

export type MetaAssetBindingStore = Pick<
  MetaConnectionRepository,
  'replaceBindings' | 'listBindings'
>;
