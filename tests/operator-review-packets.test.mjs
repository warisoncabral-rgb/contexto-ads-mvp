import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorReviewPackets } from '../lib/operator-review-packets.mjs'

const item = (overrides = {}) => ({
  workItemId: 'a'.repeat(64), tenantId: '11111111-1111-4111-8111-111111111111',
  tenantDisplayName: 'Rosa VIP', role: 'owner', campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333', source: 'operational_blocker',
  blockerCode: 'approval_valid', owner: 'operator', priority: 'high', meaning: 'Ação humana pendente.',
  nextAction: 'Revisar a evidência atual.', evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z',
  ...overrides,
})

function queue(items, comparison) {
  return {
    items,
    snapshots: [{ tenantId: '11111111-1111-4111-8111-111111111111', queueDate: '2026-08-24', comparison }],
  }
}

test('packages only operator work with evidence and change context kept separate', () => {
  const operator = item()
  const meta = item({ workItemId: 'b'.repeat(64), owner: 'meta_environment' })
  const comparison = { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [{
    ...operator, kind: 'worsened', previousPriority: 'normal', currentPriority: 'high',
    previousQueueDate: '2026-08-23', currentQueueDate: '2026-08-24',
  }] }
  const result = deriveOperatorReviewPackets(queue([meta, operator], comparison))

  assert.equal(result.totalCount, 1)
  assert.equal(result.packets[0].changeKind, 'worsened')
  assert.equal(result.packets[0].evidenceRefCount, 1)
  assert.equal(result.packets[0].previousPriority, 'normal')
  assert.equal(result.boundaries.evidenceSufficiencyInferred, false)
  assert.equal(result.boundaries.authorizationInferred, false)
})

test('keeps baseline absence explicit instead of fabricating change context', () => {
  const result = deriveOperatorReviewPackets(queue([item()], {
    baselineAvailable: false, previousQueueDate: null, changes: [],
  }))
  assert.equal(result.packets[0].baselineAvailable, false)
  assert.equal(result.packets[0].changeKind, null)
  assert.equal(result.packets[0].previousPriority, null)
  assert.equal(result.withChangeContextCount, 0)
  assert.equal(result.boundaries.completionInferred, false)
})

test('limits visible packets without changing total count', () => {
  const items = Array.from({ length: 7 }, (_, index) => item({
    workItemId: String(index + 1).repeat(64).slice(0, 64), blockerCode: `code_${index}`,
  }))
  const result = deriveOperatorReviewPackets(queue(items, {
    baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [],
  }), { limit: 3 })
  assert.equal(result.packets.length, 3)
  assert.equal(result.totalCount, 7)
  assert.equal(result.withBaselineCount, 7)
})
