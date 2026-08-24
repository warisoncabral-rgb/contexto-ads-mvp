import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorObservabilityGaps } from '../lib/operator-observability-gaps.mjs'

const queue = { snapshots: [
  { tenantId: 'a', comparison: { baselineAvailable: false }, sourceDecisions: [
    { source: 'campaign_plans', status: 'included', reason: 'ok' },
    { source: 'operational_readiness', status: 'included', reason: 'ok' },
    { source: 'execution_lifecycle', status: 'deferred', reason: 'Sem execução autorizada.' },
    { source: 'delivery_metrics', status: 'ignored', reason: 'Sem fonte verificada.' },
  ] },
  { tenantId: 'b', comparison: { baselineAvailable: true }, sourceDecisions: [
    { source: 'campaign_plans', status: 'included', reason: 'ok' },
    { source: 'operational_readiness', status: 'included', reason: 'ok' },
    { source: 'execution_lifecycle', status: 'deferred', reason: 'Sem execução autorizada.' },
    { source: 'delivery_metrics', status: 'included', reason: 'Fonte verificada.' },
  ] },
] }

test('surfaces only explicit missing baseline and deferred or ignored sources', () => {
  const result = deriveOperatorObservabilityGaps(queue)
  assert.equal(result.summary.totalGapCount, 4)
  assert.equal(result.summary.missingBaselineCount, 1)
  assert.equal(result.summary.deferredSourceCount, 2)
  assert.equal(result.summary.ignoredSourceCount, 1)
  assert.equal(result.summary.tenantCount, 2)
})

test('does not convert coverage gaps into inferred business risk or simulated data', () => {
  const result = deriveOperatorObservabilityGaps(queue)
  assert.equal(result.boundaries.businessRiskInferred, false)
  assert.equal(result.boundaries.missingDataSimulated, false)
  assert.ok(result.gaps.every((gap) => gap.reason.length > 0))
})
