import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorCurrentHistory } from '../lib/operator-current-history.mjs'
test('keeps current pending work separate from historical resolution',()=>{const queue={items:[{workItemId:'current'}],snapshots:[{comparison:{changes:[{kind:'resolved'},{kind:'entered'}]}}]};const result=deriveOperatorCurrentHistory(queue);assert.equal(result.current.pendingCount,1);assert.equal(result.history.resolvedCount,1);assert.equal(result.boundaries.resolvedTreatedAsCurrent,false)})
