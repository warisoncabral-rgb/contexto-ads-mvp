import { AnalystAnalysisV1, AnalystSnapshotV1 } from '../contracts/analyst';
import { AuditEvent } from '../contracts/audit-event';

export interface AnalystRepository {
  saveSnapshot(snapshot: AnalystSnapshotV1, event: AuditEvent): Promise<AnalystSnapshotV1>;
  latestSnapshot(tenantId: string, campaignId: string): Promise<AnalystSnapshotV1 | null>;
  previousSnapshot(
    tenantId: string,
    campaignId: string,
    beforeCollectedAt: string,
  ): Promise<AnalystSnapshotV1 | null>;
  saveAnalysis(analysis: AnalystAnalysisV1, event: AuditEvent): Promise<AnalystAnalysisV1>;
  latestAnalysis(tenantId: string, campaignId: string): Promise<AnalystAnalysisV1 | null>;
}
