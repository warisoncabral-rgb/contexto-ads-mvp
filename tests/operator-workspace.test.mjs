import assert from 'node:assert/strict'
import test from 'node:test'
import { loadOperatorWorkspace } from '../lib/operator-workspace.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const membershipId = '22222222-2222-4222-8222-222222222222'
const campaignId = '33333333-3333-4333-8333-333333333333'
const executionPlanId = '44444444-4444-4444-8444-444444444444'

const access = {
  operator: { subject: 'operator:warison', provider: 'bootstrap_token' },
  tenants: [{
    tenantId,
    displayName: 'Cliente autorizado',
    role: 'owner',
    permissions: ['view_workspace'],
    membershipId,
  }],
  boundaries: {
    tenantAccessDerivedFromMembership: true,
    publicationAuthorized: false,
    externalWritesAllowed: false,
    externalWritesPerformed: false,
  },
}

const planList = {
  tenantId,
  plans: [{
    tenantId,
    campaignId,
    executionPlanId,
    planVersion: '1.0',
    planHash: 'a'.repeat(64),
    status: 'ready_for_approval',
    campaignPackageVersion: 2,
    maximumPlannedSpendMinor: 42000,
    currency: 'BRL',
    calculation: '6000 x 7 days',
    approvalRequired: true,
    externalWritesAllowed: false,
    createdAt: '2026-08-24T16:00:00.000Z',
  }],
  boundaries: {
    tenantAccessVerified: true,
    latestPlanPerCampaign: true,
    publicationAuthorized: false,
    externalWritesAllowed: false,
    externalWritesPerformed: false,
  },
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

test('requires both backend URL and server-side operator credential', async () => {
  assert.deepEqual(await loadOperatorWorkspace({ apiBaseUrl: '', operatorToken: 'secret' }), {
    kind: 'configuration_required',
  })
  assert.deepEqual(await loadOperatorWorkspace({ apiBaseUrl: 'https://api.test', operatorToken: '' }), {
    kind: 'configuration_required',
  })
})

test('authenticates server-side and selects the first authorized tenant and plan', async () => {
  const requests = []
  const result = await loadOperatorWorkspace({
    apiBaseUrl: 'https://api.test/',
    operatorToken: 'server-only-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return url.endsWith('/v1/operator/tenants')
        ? response(access)
        : response(planList)
    },
  })

  assert.equal(result.kind, 'ready')
  assert.equal(result.selectedTenant.tenantId, tenantId)
  assert.equal(result.selectedPlan.executionPlanId, executionPlanId)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].options.headers.authorization, 'Bearer server-only-secret')
  assert.equal(requests[1].url, `https://api.test/v1/operator/tenants/${tenantId}/plans`)
})

test('refuses a tenant not returned by authenticated membership lookup', async () => {
  let requestCount = 0
  const result = await loadOperatorWorkspace({
    requestedTenantId: '55555555-5555-4555-8555-555555555555',
    apiBaseUrl: 'https://api.test',
    operatorToken: 'server-only-secret',
    fetchImpl: async () => { requestCount += 1; return response(access) },
  })
  assert.equal(result.kind, 'invalid_selection')
  assert.equal(requestCount, 1)
})

test('refuses plan payloads that cross the selected tenant boundary', async () => {
  const crossTenant = {
    ...planList,
    plans: [{ ...planList.plans[0], tenantId: '66666666-6666-4666-8666-666666666666' }],
  }
  const result = await loadOperatorWorkspace({
    apiBaseUrl: 'https://api.test',
    operatorToken: 'server-only-secret',
    fetchImpl: async (url) => url.endsWith('/tenants')
      ? response(access)
      : response(crossTenant),
  })
  assert.deepEqual(result, { kind: 'unavailable' })
})

test('sanitizes rejected credentials and backend failures', async () => {
  const denied = await loadOperatorWorkspace({
    apiBaseUrl: 'https://api.test',
    operatorToken: 'wrong-secret',
    fetchImpl: async () => response({ internal: 'do not expose' }, 401),
  })
  assert.deepEqual(denied, { kind: 'access_denied' })

  const failed = await loadOperatorWorkspace({
    apiBaseUrl: 'https://api.test',
    operatorToken: 'secret',
    fetchImpl: async () => { throw new Error('private network detail') },
  })
  assert.deepEqual(failed, { kind: 'unavailable' })
})
