import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorChangeDistribution } from '../lib/operator-change-distribution.mjs'

test('counts only persisted comparison kinds without inferring trend', () => {
  const queue = { snapshots: [
    { comparison: { baselineAvailable: true, changes: [{kind:'entered'},{kind:'worsened'},{kind:'resolved'}] } },
    { comparison: { baselineAvailable: false, changes: [] } },
  ] }
  const result = deriveOperatorChangeDistribution(queue)
  assert.equal(result.totalChanges, 3)
  assert.equal(result.distribution.find((entry)=>entry.kind==='entered').count, 1)
  assert.equal(result.comparableTenantCount, 1)
  assert.equal(result.missingBaselineCount, 1)
  assert.equal(result.boundaries.trendInferred, false)
})
