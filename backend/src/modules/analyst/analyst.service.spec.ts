import { AnalystAnalysisV1, AnalystSnapshotV1 } from '../../domain/contracts/analyst';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AnalystRepository } from '../../domain/ports/analyst.repository';
import { AnalystService } from './analyst.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '849547ce-645e-4c7b-a844-451182253fe6';

class FakeAnalystRepository implements AnalystRepository {
  snapshots: AnalystSnapshotV1[] = [];
  analyses: AnalystAnalysisV1[] = [];

  async saveSnapshot(snapshot: AnalystSnapshotV1, _event: AuditEvent) {
    const existing = this.snapshots.find((item) =>
      item.tenantId === snapshot.tenantId
      && item.campaignId === snapshot.campaignId
      && item.snapshotHash === snapshot.snapshotHash);
    if (existing) return existing;
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async latestSnapshot(tenantId: string, campaignId: string) {
    return this.snapshots
      .filter((item) => item.tenantId === tenantId && item.campaignId === campaignId)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0] ?? null;
  }

  async previousSnapshot(tenantId: string, campaignId: string, beforeCollectedAt: string) {
    return this.snapshots
      .filter((item) => item.tenantId === tenantId
        && item.campaignId === campaignId
        && item.collectedAt < beforeCollectedAt)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0] ?? null;
  }

  async saveAnalysis(analysis: AnalystAnalysisV1, _event: AuditEvent) {
    const existing = this.analyses.find((item) =>
      item.tenantId === analysis.tenantId
      && item.campaignId === analysis.campaignId
      && item.snapshotId === analysis.snapshotId);
    if (existing) return existing;
    this.analyses.push(analysis);
    return analysis;
  }

  async latestAnalysis(tenantId: string, campaignId: string) {
    return this.analyses
      .filter((item) => item.tenantId === tenantId && item.campaignId === campaignId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
  }
}

function seedSnapshot(overrides: Partial<AnalystSnapshotV1> = {}): AnalystSnapshotV1 {
  return {
    snapshotId: '11111111-1111-4111-8111-111111111111',
    snapshotHash: 'a'.repeat(64),
    tenantId: TENANT_ID,
    campaignId: CAMPAIGN_ID,
    periodStart: '2026-08-29T00:00:00Z',
    periodEnd: '2026-08-29T23:59:59Z',
    campaignStatus: 'ACTIVE',
    campaignAgeHours: 48,
    source: 'historical_import',
    metrics: {
      impressions: 3000,
      reach: 2200,
      spendMinor: 10000,
      results: 10,
      clicks: 120,
      costPerResultMinor: 1000,
    },
    collectedAt: '2026-08-30T00:00:00Z',
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: {
      periodStart: '2026-08-30T00:00:00Z',
      periodEnd: '2026-08-30T23:59:59Z',
      campaignStatus: 'ACTIVE',
      campaignAgeHours: 30,
      metrics: {
        impressions: 2500,
        reach: 1800,
        spendMinor: 10500,
        results: 10,
        clicks: 110,
      },
      ...overrides,
    },
  };
}

describe('AnalystService shadow mode', () => {
  test('scenario A: three-hour campaign waits for more data', async () => {
    const repository = new FakeAnalystRepository();
    const service = new AnalystService(repository);
    const result = await service.analyze(TENANT_ID, CAMPAIGN_ID, input({
      campaignAgeHours: 3,
      metrics: { impressions: 120, reach: 90, spendMinor: 900, results: 0, clicks: 4 },
    }), 'operator:test');

    expect(result.analysis.recommendedAction).toBe('AGUARDAR');
    expect(result.analysis.healthStatus).toBe('INSUFFICIENT_DATA');
    expect(result.analysis.confidence).toBe('low');
    expect(result.analysis.requiresApproval).toBe(false);
    expect(result.analysis.boundaries.recommendationAutoExecuted).toBe(false);
    expect(result.analysis.boundaries.metaWritePerformed).toBe(false);
  });

  test('scenario B: mature consistent deterioration recommends supervised adjustment', async () => {
    const repository = new FakeAnalystRepository();
    repository.snapshots.push(seedSnapshot());
    const service = new AnalystService(repository);
    const result = await service.analyze(TENANT_ID, CAMPAIGN_ID, input({
      campaignAgeHours: 72,
      metrics: { impressions: 3400, reach: 2300, spendMinor: 15000, results: 10, clicks: 100 },
    }), 'operator:test');

    expect(result.analysis.recommendedAction).toBe('AJUSTAR');
    expect(result.analysis.healthStatus).toBe('INTERVENTION_RECOMMENDED');
    expect(result.analysis.confidence).toBe('moderate');
    expect(result.analysis.requiresApproval).toBe(true);
  });

  test('scenario C: efficient small oscillation keeps campaign unchanged', async () => {
    const repository = new FakeAnalystRepository();
    repository.snapshots.push(seedSnapshot());
    const service = new AnalystService(repository);
    const result = await service.analyze(TENANT_ID, CAMPAIGN_ID, input(), 'operator:test');

    expect(result.analysis.recommendedAction).toBe('MANTER');
    expect(result.analysis.healthStatus).toBe('HEALTHY');
    expect(result.analysis.requiresApproval).toBe(false);
  });

  test('scenario D: delivery error is diagnosed as operational problem', async () => {
    const repository = new FakeAnalystRepository();
    const service = new AnalystService(repository);
    const result = await service.analyze(TENANT_ID, CAMPAIGN_ID, input({
      campaignStatus: 'NOT_DELIVERING',
    }), 'operator:test');

    expect(result.analysis.healthStatus).toBe('OPERATIONAL_PROBLEM');
    expect(result.analysis.recommendedAction).toBe('AJUSTAR');
    expect(result.analysis.urgency).toBe('high');
  });

  test('scenario E: recent change forces a stabilization window', async () => {
    const repository = new FakeAnalystRepository();
    repository.snapshots.push(seedSnapshot());
    const service = new AnalystService(repository);
    const result = await service.analyze(TENANT_ID, CAMPAIGN_ID, input({
      campaignAgeHours: 72,
      hoursSinceLastChange: 2,
    }), 'operator:test');

    expect(result.analysis.recommendedAction).toBe('AGUARDAR');
    expect(result.analysis.healthStatus).toBe('INSUFFICIENT_DATA');
    expect(result.analysis.reason).toContain('sobreotimização');
  });
});
