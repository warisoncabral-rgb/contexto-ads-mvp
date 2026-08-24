import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorObservabilityCatalog } from '../lib/operator-observability-catalog.mjs'
test('states observed and unavailable capabilities without enabling execution',()=>{const queue={items:[{}],snapshots:[{comparison:{baselineAvailable:true},sourceDecisions:[{},{},{},{}]}]};const result=deriveOperatorObservabilityCatalog(queue);assert.equal(result.coverage.authorizedTenants,1);assert.equal(result.capabilities.deliveryMetricsObserved,false);assert.equal(result.capabilities.externalWritesEnabled,false);assert.equal(result.boundaries.observabilityDoesNotAuthorizeExecution,true)})
