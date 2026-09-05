import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorSnapshotAudit } from '../lib/operator-snapshot-audit.mjs'
test('exposes persisted snapshot metadata without claiming authenticity',()=>{const queue={snapshots:[{snapshotId:'s',tenantId:'t',queueDate:'2026-08-24',calendarBasis:'UTC',itemCount:2,generatedAt:'2026-08-24T20:00:00Z',comparison:{baselineAvailable:true,previousQueueDate:'2026-08-23'}}]};const r=deriveOperatorSnapshotAudit(queue);assert.equal(r.snapshots[0].itemCount,2);assert.equal(r.snapshots[0].baselineAvailable,true);assert.equal(r.boundaries.contentAuthenticityInferred,false)})
