import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSelectedExecutionTarget, parseExecutionTargetBinding,
  validBoundExecutionPlan, validSelectedExecutionTarget } from '../lib/meta-execution-target.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const campaignId = '22222222-2222-4222-8222-222222222222'
const executionPlanId = '33333333-3333-4333-8333-333333333333'
const connectionId = '44444444-4444-4444-8444-444444444444'
const target = { tenantId, connectionId, adAccountId: 'act_929361834160386',
  displayName: 'Warison Cabral', selectedAssets: [{ assetType: 'ad_account',
    externalId: 'act_929361834160386' }], observedAt: '2026-08-25T22:00:00.000Z',
  boundaries: { selectedDiscoverySnapshotOnly: true, credentialExposed: false,
    publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false } }

test('accepts only a tenant-scoped selected target with closed external boundaries', () => {
  assert.equal(validSelectedExecutionTarget(target, tenantId), true)
  assert.equal(validSelectedExecutionTarget({ ...target, tenantId: campaignId }, tenantId), false)
  assert.equal(validSelectedExecutionTarget({ ...target,
    boundaries: { ...target.boundaries, externalWritesAllowed: true } }, tenantId), false)
})

test('loads the selected target with the server-only credential', async () => {
  let request
  const result = await loadSelectedExecutionTarget({ tenantId, apiBaseUrl: 'https://api.test/',
    operatorToken: 'server-secret', fetchImpl: async (url, options) => {
      request = { url, options }; return { ok: true, status: 200, json: async () => target }
    } })
  assert.equal(result.kind, 'ready')
  assert.equal(result.target.adAccountId, target.adAccountId)
  assert.equal(request.options.headers.authorization, 'Bearer server-secret')
  assert.match(request.url, /selected-execution-target$/)
})

test('distinguishes missing connection and missing selection without leaking responses', async () => {
  const missing = await loadSelectedExecutionTarget({ tenantId, apiBaseUrl: 'https://api.test',
    operatorToken: 'secret', fetchImpl: async () => ({ ok: false, status: 404 }) })
  const unselected = await loadSelectedExecutionTarget({ tenantId, apiBaseUrl: 'https://api.test',
    operatorToken: 'secret', fetchImpl: async () => ({ ok: false, status: 409 }) })
  assert.equal(missing.kind, 'not_connected')
  assert.equal(unselected.kind, 'not_selected')
})

test('parses an exact selected target binding and rejects malformed Meta ids', () => {
  const form = new FormData()
  Object.entries({ tenantId, campaignId, executionPlanId, connectionId,
    adAccountId: target.adAccountId }).forEach(([key, value]) => form.set(key, value))
  assert.equal(parseExecutionTargetBinding(form).ok, true)
  form.set('adAccountId', '../me')
  assert.equal(parseExecutionTargetBinding(form).ok, false)
})

test('accepts only a new paused plan bound to the requested selected target', () => {
  const expected = { tenantId, campaignId, executionPlanId, connectionId,
    adAccountId: target.adAccountId }
  const plan = { tenantId, campaignId,
    executionPlanId: '55555555-5555-4555-8555-555555555555',
    planHash: 'a'.repeat(64), status: 'draft',
    meta: { connectionId, adAccountId: target.adAccountId,
      assetBindings: [`ad_account:${target.adAccountId}`] },
    autonomy: { approvalRequired: true },
    externalEffects: { writesAllowed: false, writesPerformed: false } }
  assert.equal(validBoundExecutionPlan(plan, expected), true)
  assert.equal(validBoundExecutionPlan({ ...plan,
    externalEffects: { writesAllowed: true, writesPerformed: false } }, expected), false)
})
