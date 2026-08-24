import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorDailyBrief } from '../lib/operator-daily-brief.mjs'

const item = (overrides = {}) => ({
  workItemId: 'a'.repeat(64), tenantId: '11111111-1111-4111-8111-111111111111',
  tenantDisplayName: 'Rosa VIP', role: 'owner', campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333', source: 'operational_blocker',
  blockerCode: 'approval_valid', owner: 'operator', priority: 'high', meaning: 'Aprovação pendente.',
  nextAction: 'Revisar o plano.', evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z',
  ...overrides,
})

function queue({ items = [], changes = [], baselineAvailable = true } = {}) {
  return {
    items,
    snapshots: [{ comparison: { baselineAvailable, previousQueueDate: baselineAvailable ? '2026-08-23' : null, changes } }],
    summary: {
      authorizedTenantCount: 1, pendingItemCount: items.length,
      criticalCount: items.filter((entry) => entry.priority === 'critical').length,
      operatorCount: items.filter((entry) => entry.owner === 'operator').length,
      systemCount: items.filter((entry) => entry.owner === 'system').length,
      metaEnvironmentCount: items.filter((entry) => entry.owner === 'meta_environment').length,
    },
  }
}

test('prioritizes critical work and entered or worsened changes deterministically', () => {
  const critical = item({ workItemId: 'b'.repeat(64), priority: 'critical', owner: 'meta_environment', blockerCode: 'capabilities' })
  const high = item()
  const changes = [
    { ...high, kind: 'entered', previousPriority: null, currentPriority: 'high', currentQueueDate: '2026-08-24', previousQueueDate: '2026-08-23' },
    { ...critical, kind: 'worsened', previousPriority: 'high', currentPriority: 'critical', currentQueueDate: '2026-08-24', previousQueueDate: '2026-08-23' },
  ]
  const brief = deriveOperatorDailyBrief(queue({ items: [high, critical], changes }))
  assert.match(brief.headline, /1 pendência\(s\) crítica\(s\)/)
  assert.equal(brief.attention[0].priority, 'critical')
  assert.equal(brief.actionableChanges[0].kind, 'worsened')
  assert.equal(brief.summary.enteredOrWorsenedCount, 2)
  assert.equal(brief.boundaries.externalWritesPerformed, false)
})

test('does not fabricate changes or completion when there is no baseline', () => {
  const brief = deriveOperatorDailyBrief(queue({ items: [item()], changes: [], baselineAvailable: false }))
  assert.equal(brief.baselineMissingCount, 1)
  assert.equal(brief.summary.enteredOrWorsenedCount, 0)
  assert.equal(brief.summary.resolvedCount, 0)
  assert.equal(brief.boundaries.completionInferred, false)
  assert.equal(brief.boundaries.notificationsSent, false)
})

test('reports resolved and improved counts without turning them into pending work', () => {
  const resolved = { ...item(), kind: 'resolved', previousPriority: 'high', currentPriority: null,
    previousQueueDate: '2026-08-23', currentQueueDate: '2026-08-24' }
  const improved = { ...item({ workItemId: 'c'.repeat(64) }), kind: 'improved', previousPriority: 'critical', currentPriority: 'high',
    previousQueueDate: '2026-08-23', currentQueueDate: '2026-08-24' }
  const brief = deriveOperatorDailyBrief(queue({ items: [], changes: [resolved, improved] }))
  assert.equal(brief.summary.pendingCount, 0)
  assert.equal(brief.summary.resolvedCount, 1)
  assert.equal(brief.summary.improvedCount, 1)
  assert.match(brief.headline, /Nenhuma pendência operacional atual/)
})
