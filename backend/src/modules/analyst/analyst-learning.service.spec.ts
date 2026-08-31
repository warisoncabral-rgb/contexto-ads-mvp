import { AnalystLearningService } from './analyst-learning.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '849547ce-645e-4c7b-a844-451182253fe6';
const ANALYSIS_ID = '11111111-1111-4111-8111-111111111111';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: '33333333-3333-4333-8333-333333333333',
    snapshotHash: 'a'.repeat(64),
    tenantId: TENANT_ID,
    campaignId: CAMPAIGN_ID,
    periodStart: '2026-08-30T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.999Z',
    campaignStatus: 'ACTIVE',
    campaignAgeHours: 48,
    source: 'meta_readonly',
    metrics: {
      impressions: 2500,
      reach: 1800,
      spendMinor: 8000,
      results: 10,
      clicks: 120,
      costPerResultMinor: 800,
    },
    collectedAt: '2026-08-31T20:00:00.000Z',
    ...overrides,
  } as any;
}

function setup(previous: any = snapshot({
  snapshotId: '44444444-4444-4444-8444-444444444444',
  collectedAt: '2026-08-30T20:00:00.000Z',
  metrics: {
    impressions: 2200,
    reach: 1600,
    spendMinor: 10000,
    results: 10,
    clicks: 110,
    costPerResultMinor: 1000,
  },
}), existingRows: any[] = []) {
  const current = snapshot();
  const analysis = {
    analysisId: ANALYSIS_ID,
    tenantId: TENANT_ID,
    campaignId: CAMPAIGN_ID,
    snapshotId: current.snapshotId,
  } as any;
  const analyst = {
    latest: jest.fn().mockResolvedValue({ snapshot: current, analysis }),
  } as any;
  const repository = {
    previousSnapshot: jest.fn().mockResolvedValue(previous),
  } as any;
  const audit = { append: jest.fn().mockResolvedValue(undefined) } as any;
  const pool = { query: jest.fn().mockResolvedValue({ rows: existingRows }) } as any;
  return {
    service: new AnalystLearningService(analyst, repository, audit, pool),
    analyst,
    repository,
    audit,
    pool,
  };
}

describe('AnalystLearningService', () => {
  it('records a campaign-specific improvement without creating a universal rule', async () => {
    const { service, audit } = setup();
    const result = await service.refresh(TENANT_ID, CAMPAIGN_ID, 'operator:test');
    expect(result.actionStatus).toBe('RECORDED');
    expect(result.learning).toContain('nesta janela comparada');
    expect(result.learning).toContain('melhorou');
    expect(result.boundaries.contextualOnly).toBe(true);
    expect(result.boundaries.universalRuleCreated).toBe(false);
    expect(result.boundaries.autonomousTrainingPerformed).toBe(false);
    expect(result.boundaries.metaWritePerformed).toBe(false);
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append.mock.calls[0][0].eventType).toBe('analyst_learning_recorded');
  });

  it('does not invent learning when there is no previous comparable snapshot', async () => {
    const { service, audit } = setup(null);
    const result = await service.refresh(TENANT_ID, CAMPAIGN_ID, 'operator:test');
    expect(result.actionStatus).toBe('NO_LEARNING');
    expect(result.learning).toBeNull();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('returns an existing learning idempotently', async () => {
    const existing = {
      audit_event_id: '55555555-5555-4555-8555-555555555555',
      new_state: {
        learning: 'Aprendizado já registrado.',
        evidence: ['current_results=10'],
        confidence: 'moderate',
      },
      created_at: new Date('2026-08-31T20:01:00.000Z'),
    };
    const { service, audit, repository } = setup(undefined, [existing]);
    const result = await service.refresh(TENANT_ID, CAMPAIGN_ID, 'operator:test');
    expect(result.actionStatus).toBe('RECORDED');
    expect(result.learningId).toBe(existing.audit_event_id);
    expect(result.learning).toBe('Aprendizado já registrado.');
    expect(repository.previousSnapshot).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('returns NO_ANALYSIS when the campaign has not been analyzed yet', async () => {
    const { service, analyst } = setup();
    analyst.latest.mockResolvedValueOnce({ snapshot: null, analysis: null });
    const result = await service.latest(TENANT_ID, CAMPAIGN_ID);
    expect(result.actionStatus).toBe('NO_ANALYSIS');
    expect(result.learning).toBeNull();
  });
});
