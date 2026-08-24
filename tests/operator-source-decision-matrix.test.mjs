import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorSourceDecisionMatrix } from '../lib/operator-source-decision-matrix.mjs'
test('aggregates persisted source decisions without inferring source quality',()=>{const queue={snapshots:[{tenantId:'t1',sourceDecisions:[{source:'delivery_metrics',status:'ignored'}]},{tenantId:'t2',sourceDecisions:[{source:'delivery_metrics',status:'ignored'}]}]};const result=deriveOperatorSourceDecisionMatrix(queue);const row=result.sources[0];assert.equal(row.ignored,2);assert.equal(row.tenantCount,2);assert.equal(result.boundaries.sourceQualityInferred,false)})
