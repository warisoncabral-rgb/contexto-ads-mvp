import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorHumanActionEvidence } from '../lib/operator-human-action-evidence.mjs'

const item = (overrides = {}) => ({
  workItemId: 'a'.repeat(64), tenantId: '11111111-1111-4111-8111-111111111111',
  tenantDisplayName: 'Rosa VIP', role: 'owner', campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333', source: 'operational_blocker',
  blockerCode: 'approval_valid', owner: 'operator', priority: 'high', meaning: 'Ação humana pendente.',
  nextAction: 'Revisar a evidência atual.', evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z',
  ...overrides,
})

function queue(items) { return { items } }

test('separates operator items by evidence reference presence without claiming sufficiency', () => {
  const withEvidence = item({ workItemId: 'b'.repeat(64) })
  const withoutEvidence = item({ workItemId: 'c'.repeat(64), evidenceRefs: [] })
  const result = deriveOperatorHumanActionEvidence(queue([withoutEvidence, withEvidence]))

  assert.equal(result.operator.withEvidenceCount, 1)
  assert.equal(result.operator.withoutEvidenceCount, 1)
  assert.equal(result.boundaries.evidencePresenceDerivedFromRefsOnly, true)
  assert.equal(result.boundaries.evidenceSufficiencyInferred, false)
  assert.equal(result.boundaries.executionReadinessInferred, false)
})

test('keeps system and Meta environment items outside human control', () => {
  const system = item({ workItemId: 'd'.repeat(64), owner: 'system' })
  const meta = item({ workItemId: 'e'.repeat(64), owner: 'meta_environment', priority: 'critical' })
  const result = deriveOperatorHumanActionEvidence(queue([system, meta]))

  assert.equal(result.operator.totalCount, 0)
  assert.equal(result.outsideHumanControlCount, 2)
  assert.match(result.headline, /sistema ou ambiente Meta/)
  assert.equal(result.boundaries.authorizationInferred, false)
  assert.equal(result.boundaries.externalWritesPerformed, false)
})

test('limits visible evidence groups without changing totals', () => {
  const items = Array.from({ length: 7 }, (_, index) => item({
    workItemId: String(index + 1).repeat(64).slice(0, 64),
    blockerCode: `code_${index}`,
    evidenceRefs: index < 5 ? [`evidence:${index}`] : [],
  }))
  const result = deriveOperatorHumanActionEvidence(queue(items), { limit: 2 })

  assert.equal(result.operator.withEvidence.length, 2)
  assert.equal(result.operator.withEvidenceCount, 5)
  assert.equal(result.operator.withoutEvidence.length, 2)
  assert.equal(result.operator.withoutEvidenceCount, 2)
})
