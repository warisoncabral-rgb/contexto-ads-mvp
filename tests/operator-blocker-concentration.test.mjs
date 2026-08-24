import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorBlockerConcentration } from '../lib/operator-blocker-concentration.mjs'

const item = (blockerCode, tenantId, priority='normal', owner='operator') => ({ blockerCode, tenantId, priority, owner })

test('groups blockers across tenants without inferring cause', () => {
  const result = deriveOperatorBlockerConcentration({ items: [
    item('approval_valid','t1','high'), item('approval_valid','t2','critical'), item('meta_connection','t1','high','meta_environment')
  ] })
  assert.equal(result.blockers[0].blockerCode, 'approval_valid')
  assert.equal(result.blockers[0].tenantCount, 2)
  assert.equal(result.blockers[0].highestPriority, 'critical')
  assert.equal(result.repeatedAcrossTenantsCount, 1)
  assert.equal(result.boundaries.causeInferred, false)
})
