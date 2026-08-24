import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorCommandCenter } from '../lib/operator-command-center.mjs'

test('summarizes only validated queue facts and complete unique routes',()=>{
  const queue={items:[{tenantId:'t1',priority:'critical',owner:'operator'},{tenantId:'t2',priority:'normal',owner:'meta_environment'}],snapshots:[{tenantId:'t1',comparison:{baselineAvailable:true,changes:[{kind:'entered'},{kind:'resolved'}]}},{tenantId:'t3',comparison:{baselineAvailable:false,changes:[]}}]}
  const result=deriveOperatorCommandCenter(queue)
  assert.equal(result.pendingCount,2)
  assert.equal(result.criticalCount,1)
  assert.equal(result.tenantCount,2)
  assert.equal(result.enteredOrWorsenedCount,1)
  assert.equal(result.resolvedCount,1)
  assert.equal(result.baselineMissingCount,1)
  const required=['/work-queue/campaigns','/work-queue/evidence','/work-queue/changes','/work-queue/priorities','/work-queue/evidence-density','/work-queue/source-matrix','/work-queue/snapshots','/work-queue/boundaries','/work-queue/owner-priority','/work-queue/coverage','/work-queue/current-history']
  for(const href of required)assert.equal(result.navigation.some(([route])=>route===href),true)
  assert.equal(new Set(result.navigation.map(([href])=>href)).size,result.navigation.length)
  assert.equal(result.boundaries.syntheticMetricInvented,false)
})
