import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorRoleCoverage } from '../lib/operator-role-coverage.mjs'

test('reports queue membership roles without inferring permissions', () => {
  const queue = { items: [
    { role: 'owner', tenantId: 't1', priority: 'critical', owner: 'operator' },
    { role: 'viewer', tenantId: 't2', priority: 'normal', owner: 'system' },
    { role: 'viewer', tenantId: 't2', priority: 'high', owner: 'meta_environment' },
  ] }
  const result = deriveOperatorRoleCoverage(queue)
  const viewer = result.coverage.find((entry) => entry.role === 'viewer')
  assert.equal(viewer.workItemCount, 2)
  assert.equal(viewer.tenantCount, 1)
  assert.equal(viewer.systemOwnedCount, 1)
  assert.equal(viewer.metaEnvironmentOwnedCount, 1)
  assert.equal(result.boundaries.permissionsInferredFromRole, false)
  assert.equal(result.boundaries.authorizationExpanded, false)
})
