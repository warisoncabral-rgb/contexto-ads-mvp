import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePlanGenerationForm, validGeneratedPlan } from '../lib/execution-plan-view.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const campaignId = '22222222-2222-4222-8222-222222222222'
const executionPlanId = '33333333-3333-4333-8333-333333333333'

function plan(overrides = {}) {
  return {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 2,
    planVersion: '1.0',
    status: 'draft',
    createdAt: '2026-08-24T17:00:00.000Z',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL', configuredAmountMinor: 1200,
      maximumPlannedSpendMinor: 8400, calculation: '1200 x 7 days',
    },
    decisions: [{
      decisionId: 'budget_ceiling', category: 'budget', ruleId: 'maximum_spend_v1',
      inputRefs: ['campaign_context:budget'], outcome: { maximum: 8400 },
      rationale: 'Teto calculado antes da execução.',
    }],
    risks: [{
      code: 'approval_required', severity: 'high', meaning: 'Aprovação pendente.',
      mitigation: 'Aprovar o hash exato.', blocksExecution: true,
    }],
    objectsToCreate: [
      { internalObjectId: 'campaign', type: 'campaign', dependsOn: [], logicalConfig: { lifecycleStatus: 'PAUSED' } },
      { internalObjectId: 'adset', type: 'ad_set', dependsOn: ['campaign'], logicalConfig: { lifecycleStatus: 'PAUSED' } },
      { internalObjectId: 'creative', type: 'creative', dependsOn: [], logicalConfig: { copyStatus: 'requires_generation_and_approval', claimsPolicy: 'source_only' } },
      { internalObjectId: 'ad', type: 'ad', dependsOn: ['adset', 'creative'], logicalConfig: { lifecycleStatus: 'PAUSED' } },
    ],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    ...overrides,
  }
}

test('parses an explicit tenant, campaign and immutable context version', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('campaignId', campaignId)
  form.set('contextVersion', '2')
  assert.deepEqual(parsePlanGenerationForm(form), {
    ok: true, tenantId, campaignId, contextVersion: 2,
  })
})

test('rejects malformed or missing generation scope before backend access', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('campaignId', 'other-tenant-campaign')
  form.set('contextVersion', '0')
  assert.equal(parsePlanGenerationForm(form).ok, false)
})

test('accepts only a matching A0 draft with paused objects and no external effects', () => {
  assert.equal(validGeneratedPlan(plan(), { tenantId, campaignId, contextVersion: 2 }), true)
})

test('refuses a plan that claims writes or active objects', () => {
  assert.equal(validGeneratedPlan(plan({
    externalEffects: { writesAllowed: true, writesPerformed: false },
  }), { tenantId, campaignId, contextVersion: 2 }), false)

  const active = plan()
  active.objectsToCreate[0].logicalConfig.lifecycleStatus = 'ACTIVE'
  assert.equal(validGeneratedPlan(active, { tenantId, campaignId, contextVersion: 2 }), false)
})

test('refuses cross-tenant, cross-campaign or different context-version responses', () => {
  assert.equal(validGeneratedPlan(plan(), {
    tenantId: '44444444-4444-4444-8444-444444444444', campaignId, contextVersion: 2,
  }), false)
  assert.equal(validGeneratedPlan(plan(), { tenantId, campaignId, contextVersion: 3 }), false)
})
