import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorOwnerPriorityMatrix } from '../lib/operator-owner-priority-matrix.mjs'
test('crosses persisted owner and priority without inferring control',()=>{const queue={items:[{owner:'operator',priority:'critical',tenantId:'t1'},{owner:'operator',priority:'high',tenantId:'t2'},{owner:'system',priority:'normal',tenantId:'t1'}]};const result=deriveOperatorOwnerPriorityMatrix(queue);const operator=result.rows.find(row=>row.owner==='operator');assert.equal(operator.counts.critical,1);assert.equal(operator.tenantCount,2);assert.equal(result.boundaries.controlInferred,false)})
