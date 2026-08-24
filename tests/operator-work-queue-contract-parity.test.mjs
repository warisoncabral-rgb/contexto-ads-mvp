import test from 'node:test'
import assert from 'node:assert/strict'
import { validWorkQueue } from '../lib/operator-work-queue.mjs'

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const item = { workItemId: 'a'.repeat(64), tenantId: id('1'), tenantDisplayName: 'Tenant', role: 'owner',
  campaignId: id('2'), executionPlanId: id('3'), source: 'operational_blocker', blockerCode: 'approval_valid',
  owner: 'operator', priority: 'critical', meaning: 'Pendente.', nextAction: 'Revisar.', evidenceRefs: ['approval:none'],
  observedAt: '2026-08-24T18:00:00.000Z' }
const sourceDecisions = [
  { source: 'campaign_plans', status: 'included', reason: 'Planos.' },
  { source: 'operational_readiness', status: 'included', reason: 'Prontidão.' },
  { source: 'execution_lifecycle', status: 'deferred', reason: 'Sem execução.' },
  { source: 'delivery_metrics', status: 'ignored', reason: 'Sem métricas.' },
]
const make = (change) => ({ items: [item], snapshots: [{ snapshotId: id('4'), tenantId: id('1'),
  queueDate: '2026-08-24', calendarBasis: 'UTC', snapshotHash: 'b'.repeat(64), itemCount: 1, sourceDecisions,
  comparison: { baselineAvailable: true, previousQueueDate: '2026-08-23', changes: [change] },
  generatedAt: '2026-08-24T18:00:00.000Z' }], summary: { authorizedTenantCount: 1, pendingItemCount: 1,
  criticalCount: 1, operatorCount: 1, systemCount: 0, metaEnvironmentCount: 0 }, boundaries: {
  derivedFromCurrentReadiness: true, tenantAccessDerivedFromMembership: true, priorityRuleIsDeterministic: true,
  deadlinesFabricated: false, completionInferred: false, dailySnapshotsPersisted: true,
  publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false },
  generatedAt: '2026-08-24T18:00:00.000Z' })
const baseChange = { workItemId: item.workItemId, tenantId: item.tenantId, tenantDisplayName: item.tenantDisplayName,
  campaignId: item.campaignId, executionPlanId: item.executionPlanId, blockerCode: item.blockerCode,
  kind: 'entered', previousPriority: null, currentPriority: 'critical', meaning: item.meaning,
  evidenceRefs: item.evidenceRefs, previousQueueDate: '2026-08-23', currentQueueDate: '2026-08-24' }

test('accepts change kinds only when priority transitions agree with their semantics', () => {
  assert.equal(validWorkQueue(make(baseChange)), true)
  assert.equal(validWorkQueue(make({ ...baseChange, kind: 'entered', previousPriority: 'normal' })), false)
  assert.equal(validWorkQueue(make({ ...baseChange, kind: 'resolved', previousPriority: 'critical', currentPriority: 'critical' })), false)
  assert.equal(validWorkQueue(make({ ...baseChange, kind: 'worsened', previousPriority: 'critical', currentPriority: 'normal' })), false)
  assert.equal(validWorkQueue(make({ ...baseChange, kind: 'improved', previousPriority: 'normal', currentPriority: 'critical' })), false)
  assert.equal(validWorkQueue(make({ ...baseChange, kind: 'unchanged', previousPriority: 'normal', currentPriority: 'high' })), false)
})

test('requires a valid queue generation timestamp', () => {
  assert.equal(validWorkQueue({ ...make(baseChange), generatedAt: 'not-a-date' }), false)
})
