import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorSourceCoverage } from '../lib/operator-source-coverage.mjs'

const decisions = (delivery = 'ignored') => [
  { source: 'campaign_plans', status: 'included', reason: 'Planos.' },
  { source: 'operational_readiness', status: 'included', reason: 'Prontidão.' },
  { source: 'execution_lifecycle', status: 'deferred', reason: 'Execução adiada.' },
  { source: 'delivery_metrics', status: delivery, reason: 'Métricas.' },
]
const queue = { snapshots: [
  { tenantId: 'a', queueDate: '2026-08-24', sourceDecisions: decisions('ignored') },
  { tenantId: 'b', queueDate: '2026-08-24', sourceDecisions: decisions('included') },
] }

test('aggregates source coverage across every tenant instead of using the first snapshot as a proxy', () => {
  const result = deriveOperatorSourceCoverage(queue)
  const metrics = result.sources.find((source) => source.source === 'delivery_metrics')
  assert.equal(result.summary.tenantCount, 2)
  assert.equal(metrics.includedCount, 1)
  assert.equal(metrics.ignoredCount, 1)
  assert.equal(metrics.uniformStatus, null)
  assert.equal(result.summary.mixedSourceStatusCount, 1)
  assert.equal(result.boundaries.firstTenantUsedAsGlobalProxy, false)
})

test('preserves per-tenant source decisions without inferring availability', () => {
  const result = deriveOperatorSourceCoverage(queue)
  assert.equal(result.tenants[0].decisions[3].status, 'ignored')
  assert.equal(result.tenants[1].decisions[3].status, 'included')
  assert.equal(result.summary.tenantsWithDeferredCount, 2)
  assert.equal(result.boundaries.sourceAvailabilityInferred, false)
})
