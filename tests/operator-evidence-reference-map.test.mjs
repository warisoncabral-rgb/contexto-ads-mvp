import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorEvidenceReferenceMap } from '../lib/operator-evidence-reference-map.mjs'

test('groups evidence references by syntax without claiming validity', () => {
  const queue = { items: [
    { workItemId: 'w1', tenantId: 't1', owner: 'operator', evidenceRefs: ['approval:a', 'approval:b', 'plain-ref'] },
    { workItemId: 'w2', tenantId: 't2', owner: 'meta_environment', evidenceRefs: ['capability:x'] },
  ] }
  const result = deriveOperatorEvidenceReferenceMap(queue)
  assert.equal(result.summary.referenceCount, 4)
  assert.equal(result.namespaces.find((entry) => entry.namespace === 'approval').referenceCount, 2)
  assert.equal(result.summary.unscopedReferenceCount, 1)
  assert.equal(result.boundaries.namespaceIsSyntacticOnly, true)
  assert.equal(result.boundaries.evidenceValidityInferred, false)
  assert.equal(result.boundaries.evidenceSufficiencyInferred, false)
})
