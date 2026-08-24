import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorCommandCenter } from '../lib/operator-command-center.mjs'

test('summarizes only validated queue facts and known routes',()=>{
  const queue={items:[{tenantId:'t1',priority:'critical',owner:'operator'},{tenantId:'t2',priority:'normal',owner:'meta_environment'}],snapshots:[{comparison:{baselineAvailable:true,changes:[{kind:'entered'},{kind:'resolved'}]}},{comparison:{baselineAvailable:false,changes:[]}}]}
  const result=deriveOperatorCommandCenter(queue)
  assert.equal(result.pendingCount,2)
  assert.equal(result.criticalCount,1)
  assert.equal(result.enteredOrWorsenedCount,1)
  assert.equal(result.resolvedCount,1)
  assert.equal(result.baselineMissingCount,1)
  assert.equal(result.navigation.some(([href])=>href==='/work-queue/campaigns'),true)
  assert.equal(result.navigation.some(([href])=>href==='/work-queue/evidence'),true)
  assert.equal(new Set(result.navigation.map(([href])=>href)).size,result.navigation.length)
  assert.equal(result.boundaries.syntheticMetricInvented,false)
})
