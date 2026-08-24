import { Pool, PoolClient } from 'pg';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { PostgresApprovalRepository } from './postgres-approval.repository';

describe('PostgresApprovalRepository', () => {
  const approval: ApprovalV1 = {
    approvalId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    executionPlanId: '33333333-3333-4333-8333-333333333333',
    campaignId: '44444444-4444-4444-8444-444444444444',
    planVersion: '1.0',
    approvedPlanHash: 'a'.repeat(64),
    actionType: 'approve_campaign_plan',
    riskLevel: 'high',
    scope: ['external_write:false'],
    requestedBy: 'warison',
    expiresAt: '2026-08-25T09:00:00.000Z',
    status: 'pending',
    correlationId: '55555555-5555-4555-8555-555555555555',
    createdAt: '2026-08-24T09:00:00.000Z',
    updatedAt: '2026-08-24T09:00:00.000Z',
  };
  const row = {
    approval_id: approval.approvalId,
    tenant_id: approval.tenantId,
    execution_plan_id: approval.executionPlanId,
    campaign_id: approval.campaignId,
    plan_version: approval.planVersion,
    approved_plan_hash: approval.approvedPlanHash,
    action_type: approval.actionType,
    risk_level: approval.riskLevel,
    scope: approval.scope,
    requested_by: approval.requestedBy,
    approved_by: null,
    approved_at: null,
    expires_at: new Date(approval.expiresAt!),
    decision_reason: null,
    status: approval.status,
    correlation_id: approval.correlationId,
    created_at: new Date(approval.createdAt),
    updated_at: new Date(approval.updatedAt),
  };
  const event: AuditEvent = {
    auditEventId: '66666666-6666-4666-8666-666666666666',
    tenantId: approval.tenantId,
    correlationId: approval.correlationId,
    actorType: 'user',
    actorId: 'warison',
    eventType: 'campaign_plan_approval_requested',
    objectType: 'plan_approval',
    objectId: approval.approvalId,
    newState: { status: 'pending' },
    result: 'success',
    createdAt: approval.createdAt,
  };
  const clientQuery = jest.fn();
  const release = jest.fn();
  const poolQuery = jest.fn();
  const pool = {
    connect: jest.fn().mockResolvedValue({ query: clientQuery, release } as unknown as PoolClient),
    query: poolQuery,
  } as unknown as Pool;
  const repository = new PostgresApprovalRepository(pool);

  beforeEach(() => {
    clientQuery.mockReset();
    poolQuery.mockReset();
    release.mockReset();
  });

  it('persists approval request and audit event in one transaction', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.request(approval, event)).resolves.toEqual(approval);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('insert into plan_approvals'),
      expect.stringContaining('insert into audit_events'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns the active approval idempotently without duplicating its audit event', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.request(approval, event)).resolves.toEqual(approval);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('insert into plan_approvals'),
      expect.stringContaining("status in ('pending', 'approved')"),
      'commit',
    ]);
  });

  it('approves atomically only while the hash is the latest campaign plan', async () => {
    const approvedRow = {
      ...row,
      status: 'approved',
      approved_by: 'warison',
      approved_at: new Date('2026-08-24T10:00:00.000Z'),
      updated_at: new Date('2026-08-24T10:00:00.000Z'),
    };
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [approvedRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await repository.approveIfCurrent(
      approval.tenantId,
      approval.approvalId,
      'warison',
      '2026-08-24T10:00:00.000Z',
      { ...event, eventType: 'campaign_plan_approved' },
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'approved',
      approvedBy: 'warison',
      approvedAt: '2026-08-24T10:00:00.000Z',
    }));
    expect(clientQuery.mock.calls[1][0]).toContain('approved_plan_hash = (');
    expect(clientQuery.mock.calls[2][0]).toContain('insert into audit_events');
  });

  it('invalidates an approval and audits it in the same transaction', async () => {
    const invalidatedRow = {
      ...row,
      status: 'invalidated',
      decision_reason: 'plan_hash_changed',
    };
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [invalidatedRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.invalidateIfStale(
      approval.tenantId,
      approval.approvalId,
      '2026-08-24T11:00:00.000Z',
      { ...event, eventType: 'campaign_plan_approval_invalidated' },
    )).resolves.toEqual(expect.objectContaining({
      status: 'invalidated',
      decisionReason: 'plan_hash_changed',
    }));
    expect(clientQuery.mock.calls[1][0]).toContain('approved_plan_hash <>');
  });

  it('rolls back the approval transition if audit persistence fails', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.transition(
      approval.tenantId,
      approval.approvalId,
      ['pending'],
      'rejected',
      '2026-08-24T11:00:00.000Z',
      'budget rejected',
      event,
    )).rejects.toThrow('audit unavailable');
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('invalidates every active approval superseded by a new campaign hash', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.invalidateForCampaignExceptHash(
      approval.tenantId,
      approval.campaignId,
      'b'.repeat(64),
      '2026-08-24T12:00:00.000Z',
    )).resolves.toBe(1);
    expect(clientQuery.mock.calls[1][0]).toContain('for update');
    expect(clientQuery.mock.calls[2][0]).toContain("set status = 'invalidated'");
    expect(clientQuery.mock.calls[3][0]).toContain('insert into audit_events');
  });
});
