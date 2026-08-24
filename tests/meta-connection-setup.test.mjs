import test from 'node:test'
import assert from 'node:assert/strict'
import { validConnectionStart, validOAuthStart, validTenantAccess } from '../lib/meta-connection-setup.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'

test('accepts only membership-derived tenant access', () => {
  assert.equal(validTenantAccess({ tenants: [{ tenantId, displayName: 'Cliente', role: 'owner', permissions: ['configure_tenant'] }], boundaries: {
    tenantAccessDerivedFromMembership: true, publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false,
  } }), true)
})

test('accepts only a tenant-scoped pending Meta connection', () => {
  assert.equal(validConnectionStart({ tenantId, connectionId, provider: 'meta', status: 'authorization_pending', externalWritePerformed: false }, tenantId), true)
  assert.equal(validConnectionStart({ tenantId: '33333333-3333-4333-8333-333333333333', connectionId, provider: 'meta', status: 'authorization_pending', externalWritePerformed: false }, tenantId), false)
})

test('OAuth start stays read-only and server-owned', () => {
  const url = `https://www.facebook.com/v26.0/dialog/oauth?client_id=1&state=${'s'.repeat(43)}&scope=public_profile%2Cads_read%2Cpages_show_list`
  assert.equal(validOAuthStart({ connectionId, scopeProfile: 'read_only', requestedScopes: ['public_profile', 'ads_read', 'pages_show_list'], authorizationUrl: url, externalCallPerformed: false, writeAuthorized: false }, connectionId), true)
  assert.equal(validOAuthStart({ connectionId, scopeProfile: 'controlled_write_validation', requestedScopes: ['public_profile', 'ads_read', 'pages_show_list', 'ads_management'], authorizationUrl: url, externalCallPerformed: false, writeAuthorized: false }, connectionId), false)
})
