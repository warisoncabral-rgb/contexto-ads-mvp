import assert from 'node:assert/strict'
import test from 'node:test'
import { loadOperationalTimeline, validTimeline } from '../lib/operational-timeline.mjs'

const plan = { tenantId: '11111111-1111-4111-8111-111111111111', campaignId: '22222222-2222-4222-8222-222222222222', executionPlanId: '33333333-3333-4333-8333-333333333333' }
const timeline = { ...plan, items: [{ auditEventId: '44444444-4444-4444-8444-444444444444', category: 'approval', title: 'Plano aprovado', detail: 'A decisão foi vinculada ao hash.', result: 'success', actor: 'Usuário autenticado', evidenceRef: 'plan_approval:55555555-5555-4555-8555-555555555555', createdAt: '2026-08-24T18:00:00.000Z' }], boundaries: { sanitizedOperationalHistory: true, immutableAuditSource: true, secretsExposed: false, publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false }, generatedAt: '2026-08-24T18:01:00.000Z' }

test('accepts only sanitized timeline evidence bound to the selected campaign and plan', () => {
  assert.equal(validTimeline(timeline, plan), true)
  assert.equal(validTimeline({ ...timeline, campaignId: '66666666-6666-4666-8666-666666666666' }, plan), false)
  assert.equal(validTimeline({ ...timeline, boundaries: { ...timeline.boundaries, secretsExposed: true } }, plan), false)
})

test('loads the timeline with tenant-scoped server authentication', async () => {
  let request
  const result = await loadOperationalTimeline({ plan, apiBaseUrl: 'https://api.test/', operatorToken: 'secret', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => timeline } } })
  assert.equal(result.kind, 'ready')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.match(request.url, new RegExp(`/tenants/${plan.tenantId}/campaigns/${plan.campaignId}/timeline`))
  assert.match(request.url, new RegExp(`executionPlanId=${plan.executionPlanId}$`))
})

test('fails closed on cross-plan or sensitive-looking response shapes', async () => {
  const result = await loadOperationalTimeline({ plan, apiBaseUrl: 'https://api.test', operatorToken: 'secret', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...timeline, executionPlanId: '77777777-7777-4777-8777-777777777777' }) }) })
  assert.equal(result.kind, 'unavailable')
})
