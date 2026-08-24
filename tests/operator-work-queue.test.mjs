import test from 'node:test'
import assert from 'node:assert/strict'
import { loadOperatorWorkQueue, validWorkQueue } from '../lib/operator-work-queue.mjs'

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const change = { workItemId: 'a'.repeat(64), tenantId: id('1'), tenantDisplayName: 'Rosa VIP',
  campaignId: id('2'), executionPlanId: id('3'), blockerCode: 'approval_valid', kind: 'entered',
  previousPriority: null, currentPriority: 'critical', meaning: 'Aprovação pendente.',
  evidenceRefs: ['approval:none'], previousQueueDate: '2026-08-23', currentQueueDate: '2026-08-24' }
const payload = { items: [{ workItemId: 'a'.repeat(64), tenantId: id('1'),
  tenantDisplayName: 'Rosa VIP', role: 'owner', campaignId: id('2'), executionPlanId: id('3'),
  source: 'operational_blocker', blockerCode: 'approval_valid', owner: 'operator',
  priority: 'critical', meaning: 'Aprovação pendente.', nextAction: 'Revisar o plano.',
  evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z' }],
  snapshots: [{ snapshotId: id('4'), tenantId: id('1'), queueDate: '2026-08-24',
    calendarBasis: 'UTC', snapshotHash: 'b'.repeat(64), itemCount: 1,
    sourceDecisions: [
      { source: 'campaign_plans', status: 'included', reason: 'Planos persistidos.' },
      { source: 'operational_readiness', status: 'included', reason: 'Prontidão persistida.' },
      { source: 'execution_lifecycle', status: 'deferred', reason: 'Sem execução autorizada.' },
      { source: 'delivery_metrics', status: 'ignored', reason: 'Sem fonte verificada.' },
    ], comparison: { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [change] },
    generatedAt: '2026-08-24T18:00:00.000Z' }],
  summary: { authorizedTenantCount: 1, pendingItemCount: 1, criticalCount: 1,
    operatorCount: 1, systemCount: 0, metaEnvironmentCount: 0 },
  boundaries: { derivedFromCurrentReadiness: true, tenantAccessDerivedFromMembership: true,
    priorityRuleIsDeterministic: true, deadlinesFabricated: false, completionInferred: false,
    dailySnapshotsPersisted: true,
    publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false },
  generatedAt: '2026-08-24T18:00:00.000Z' }

test('accepts only an evidence-derived read-only work queue with proven comparison', () => {
  assert.equal(validWorkQueue(payload), true)
  assert.equal(validWorkQueue({ ...payload, boundaries: { ...payload.boundaries, deadlinesFabricated: true } }), false)
  assert.equal(validWorkQueue({ ...payload, items: [{ ...payload.items[0], owner: 'unknown' }] }), false)
  assert.equal(validWorkQueue({ ...payload, snapshots: [{ ...payload.snapshots[0], comparison: undefined }] }), false)
})

test('accepts an explicit missing baseline without fabricating changes', () => {
  const snapshot = { ...payload.snapshots[0], comparison: {
    baselineAvailable: false, previousQueueDate: null, changes: [] } }
  assert.equal(validWorkQueue({ ...payload, snapshots: [snapshot] }), true)
  assert.equal(validWorkQueue({ ...payload, snapshots: [{ ...snapshot, comparison: {
    ...snapshot.comparison, changes: [change] } }] }), false)
})

test('loads the queue with server-side authentication and no cache', async () => {
  let request
  const result = await loadOperatorWorkQueue({ apiBaseUrl: 'https://api.test/', operatorToken: 'secret', fetchImpl: async (url, options) => {
    request = { url, options }; return { ok: true, status: 200, json: async () => payload }
  } })
  assert.equal(result.kind, 'ready')
  assert.equal(request.url, 'https://api.test/v1/operator/work-queue')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.equal(request.options.cache, 'no-store')
})

test('fails closed for missing configuration, denied access, and malformed response', async () => {
  assert.equal((await loadOperatorWorkQueue({ apiBaseUrl: '', operatorToken: '' })).kind, 'configuration_required')
  assert.equal((await loadOperatorWorkQueue({ apiBaseUrl: 'x', operatorToken: 'x', fetchImpl: async () => ({ ok: false, status: 401 }) })).kind, 'access_denied')
  assert.equal((await loadOperatorWorkQueue({ apiBaseUrl: 'x', operatorToken: 'x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })).kind, 'unavailable')
})
