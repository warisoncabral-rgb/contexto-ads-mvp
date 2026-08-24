import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorEvidenceDensity } from '../lib/operator-evidence-density.mjs'
test('counts evidence references without claiming sufficiency',()=>{const q={items:[{workItemId:'a',tenantId:'t',campaignId:'c',owner:'operator',priority:'high',evidenceRefs:['x','y']}]};const r=deriveOperatorEvidenceDensity(q);assert.equal(r.totalEvidenceRefs,2);assert.equal(r.rows[0].evidenceRefCount,2);assert.equal(r.boundaries.evidenceSufficiencyInferred,false)})
