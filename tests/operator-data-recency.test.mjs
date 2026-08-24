import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorDataRecency } from '../lib/operator-data-recency.mjs'

const queue = {
  generatedAt: '2026-08-24T18:10:00.000Z',
  items: [
    { tenantId: 'a', observedAt: '2026-08-24T18:00:00.000Z' },
    { tenantId: 'a', observedAt: '2026-08-24T18:05:00.000Z' },
    { tenantId: 'b', observedAt: '2026-08-24T17:50:00.000Z' },
  ],
  snapshots: [
    { tenantId: 'a', queueDate: '2026-08-24', generatedAt: '2026-08-24T18:06:00.000Z' },
    { tenantId: 'b', queueDate: '2026-08-24', generatedAt: '2026-08-24T17:55:00.000Z' },
  ],
}

test('reports persisted recency timestamps without inventing a stale threshold', () => {
  const result = deriveOperatorDataRecency(queue)
  assert.equal(result.oldestItemObservedAt, '2026-08-24T17:50:00.000Z')
  assert.equal(result.newestItemObservedAt, '2026-08-24T18:05:00.000Z')
  assert.equal(result.oldestSnapshotGeneratedAt, '2026-08-24T17:55:00.000Z')
  assert.equal(result.boundaries.staleThresholdInvented, false)
  assert.equal(result.boundaries.freshnessClaimInferred, false)
})

test('keeps tenant timestamps scoped to the matching tenant', () => {
  const result = deriveOperatorDataRecency(queue)
  assert.deepEqual(result.tenants[0].itemObservedAt, ['2026-08-24T18:00:00.000Z', '2026-08-24T18:05:00.000Z'])
  assert.deepEqual(result.tenants[1].itemObservedAt, ['2026-08-24T17:50:00.000Z'])
})
