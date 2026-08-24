import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorPriorityDistribution } from '../lib/operator-priority-distribution.mjs'
test('counts persisted priorities without inventing risk',()=>{const q={items:[{priority:'critical',tenantId:'t1'},{priority:'high',tenantId:'t1'},{priority:'high',tenantId:'t2'}]};const r=deriveOperatorPriorityDistribution(q);assert.equal(r.distribution.find(x=>x.priority==='high').count,2);assert.equal(r.distribution.find(x=>x.priority==='high').tenantCount,2);assert.equal(r.boundaries.riskScoreInvented,false)})
