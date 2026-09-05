import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorTenantDailyPulse } from '../lib/operator-tenant-daily-pulse.mjs'

const item = (tenantId, name, overrides = {}) => ({
  workItemId: (overrides.workItemId ?? 'a'.repeat(64)), tenantId, tenantDisplayName: name, role: 'owner',
  campaignId: '22222222-2222-4222-8222-222222222222', executionPlanId: '33333333-3333-4333-8333-333333333333',
  source: 'operational_blocker', blockerCode: overrides.blockerCode ?? 'approval_valid', owner: overrides.owner ?? 'operator',
  priority: overrides.priority ?? 'high', meaning: 'Pendência.', nextAction: 'Revisar.', evidenceRefs: ['evidence:x'],
  observedAt: '2026-08-24T18:00:00.000Z',
})

const t1 = '11111111-1111-4111-8111-111111111111'
const t2 = '44444444-4444-4444-8444-444444444444'

function snapshot(tenantId, comparison) { return { tenantId, comparison } }

test('aggregates per tenant and ranks critical/new-risk clients first', () => {
  const queue = {
    items: [
      item(t1, 'Rosa VIP', { workItemId: 'a'.repeat(64), priority: 'critical', owner: 'meta_environment' }),
      item(t1, 'Rosa VIP', { workItemId: 'b'.repeat(64), priority: 'high', owner: 'operator' }),
      item(t2, 'Cliente B', { workItemId: 'c'.repeat(64), priority: 'high', owner: 'system' }),
    ],
    snapshots: [
      snapshot(t1, { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [{ kind: 'worsened' }] }),
      snapshot(t2, { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [] }),
    ],
  }
  const result = deriveOperatorTenantDailyPulse(queue)
  assert.equal(result.tenants[0].tenantId, t1)
  assert.equal(result.tenants[0].criticalCount, 1)
  assert.equal(result.tenants[0].operatorCount, 1)
  assert.equal(result.tenants[0].metaEnvironmentCount, 1)
  assert.equal(result.tenants[0].enteredOrWorsenedCount, 1)
  assert.equal(result.summary.tenantsWithCriticalCount, 1)
  assert.equal(result.boundaries.riskScoreInvented, false)
})

test('keeps missing baseline explicit at tenant level', () => {
  const result = deriveOperatorTenantDailyPulse({
    items: [item(t1, 'Rosa VIP')],
    snapshots: [snapshot(t1, { baselineAvailable: false, previousQueueDate: null, changes: [] })],
  })
  assert.equal(result.tenants[0].baselineAvailable, false)
  assert.equal(result.summary.tenantsWithoutBaselineCount, 1)
  assert.equal(result.tenants[0].enteredOrWorsenedCount, 0)
  assert.equal(result.boundaries.completionInferred, false)
})

test('does not create tenants without current work items', () => {
  const result = deriveOperatorTenantDailyPulse({
    items: [], snapshots: [snapshot(t1, { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [{ kind: 'resolved' }] })],
  })
  assert.equal(result.summary.tenantCount, 0)
  assert.deepEqual(result.tenants, [])
})
