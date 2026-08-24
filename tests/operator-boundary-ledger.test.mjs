import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorBoundaryLedger } from '../lib/operator-boundary-ledger.mjs'
test('verifies every read-only queue boundary explicitly',()=>{const boundaries={derivedFromCurrentReadiness:true,tenantAccessDerivedFromMembership:true,priorityRuleIsDeterministic:true,deadlinesFabricated:false,completionInferred:false,dailySnapshotsPersisted:true,publicationAuthorized:false,externalWritesAllowed:false,externalWritesPerformed:false};const result=deriveOperatorBoundaryLedger({boundaries});assert.equal(result.allMatched,true);assert.equal(result.entries.length,9);assert.equal(result.boundaries.authorizationExpanded,false)})
