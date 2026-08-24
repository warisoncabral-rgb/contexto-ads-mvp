import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorDecisionAgenda } from '../lib/operator-decision-agenda.mjs'

const item = (overrides = {}) => ({
  workItemId: 'a'.repeat(64), tenantId: '11111111-1111-4111-8111-111111111111',
  tenantDisplayName: 'Rosa VIP', role: 'owner', campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333', source: 'operational_blocker',
  blockerCode: 'approval_valid', owner: 'operator', priority: 'high', meaning: 'Ação humana pendente.',
  nextAction: 'Revisar a evidência atual.', evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z',
  ...overrides,
})

function queue(items) {
  return { items, summary: { pendingItemCount: items.length } }
}

test('separates responsibilities strictly from the persisted work item owner', () => {
  const operator = item({ workItemId: 'b'.repeat(64), owner: 'operator', priority: 'critical' })
  const system = item({ workItemId: 'c'.repeat(64), owner: 'system', priority: 'normal' })
  const meta = item({ workItemId: 'd'.repeat(64), owner: 'meta_environment', priority: 'critical' })
  const agenda = deriveOperatorDecisionAgenda(queue([system, meta, operator]))

  assert.equal(agenda.lanes.operator[0].workItemId, operator.workItemId)
  assert.equal(agenda.lanes.system[0].workItemId, system.workItemId)
  assert.equal(agenda.lanes.metaEnvironment[0].workItemId, meta.workItemId)
  assert.equal(agenda.summary.criticalOperatorCount, 1)
  assert.equal(agenda.boundaries.responsibilityDerivedFromWorkItemOwner, true)
  assert.equal(agenda.boundaries.ownerDecisionTypeInferred, false)
})

test('does not call environment or system blockers human decisions', () => {
  const agenda = deriveOperatorDecisionAgenda(queue([
    item({ owner: 'meta_environment', priority: 'critical' }),
    item({ workItemId: 'b'.repeat(64), owner: 'system', priority: 'high' }),
  ]))
  assert.equal(agenda.summary.operatorCount, 0)
  assert.match(agenda.headline, /Nenhuma ação humana atual/)
  assert.equal(agenda.boundaries.completionInferred, false)
  assert.equal(agenda.boundaries.externalWritesPerformed, false)
})

test('limits each lane without changing total responsibility counts', () => {
  const items = Array.from({ length: 7 }, (_, index) => item({
    workItemId: String(index + 1).repeat(64).slice(0, 64),
    blockerCode: `code_${index}`, priority: index === 0 ? 'critical' : 'high',
  }))
  const agenda = deriveOperatorDecisionAgenda(queue(items), { limitPerLane: 3 })
  assert.equal(agenda.lanes.operator.length, 3)
  assert.equal(agenda.summary.operatorCount, 7)
  assert.equal(agenda.summary.criticalOperatorCount, 1)
})
