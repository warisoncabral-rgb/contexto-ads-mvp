import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorTenantCoverage } from '../lib/operator-tenant-coverage.mjs'
test('keeps authorized zero-item tenants visible',()=>{const queue={items:[{tenantId:'t1'}],snapshots:[{tenantId:'t1',queueDate:'2026-08-24',comparison:{baselineAvailable:true}},{tenantId:'t2',queueDate:'2026-08-24',comparison:{baselineAvailable:false}}]};const result=deriveOperatorTenantCoverage(queue);assert.equal(result.authorizedTenantCount,2);assert.equal(result.tenantsWithoutPendingWork,1);assert.equal(result.tenants.find(x=>x.tenantId==='t2').hasPendingWork,false);assert.equal(result.boundaries.zeroItemsTreatedAsAbsence,false)})
