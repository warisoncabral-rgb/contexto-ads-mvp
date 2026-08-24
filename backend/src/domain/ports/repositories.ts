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
  create(context: CampaignContextPackageV1): Promise<void>;
  appendNext(
    context: UnversionedCampaignContextPackageV1,
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

export interface ExecutionPlanRepository {
  saveIdempotent(plan: ExecutionPlanV1): Promise<ExecutionPlanV1>;
  latest(tenantId: string, campaignId: string): Promise<ExecutionPlanV1 | null>;
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
  latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionSimulationReportV1 | null>;
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
