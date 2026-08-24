import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorControlBoundaries } from '../lib/operator-control-boundaries.mjs'

const item=(owner,tenantId,priority='normal',blockerCode='x')=>({owner,tenantId,priority,blockerCode,tenantDisplayName:tenantId})

test('separates responsibility domains without inferring controllability',()=>{
  const result=deriveOperatorControlBoundaries({items:[item('operator','A','high'),item('system','A'),item('meta_environment','B','critical')]})
  assert.equal(result.operator.count,1)
  assert.equal(result.system.count,1)
  assert.equal(result.metaEnvironment.count,1)
  assert.equal(result.externalEnvironmentCount,1)
  assert.equal(result.boundaries.responsibilityDerivedFromOwnerOnly,true)
  assert.equal(result.boundaries.controllabilityInferred,false)
})
