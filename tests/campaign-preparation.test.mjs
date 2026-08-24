import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCampaignPreparation, parseCampaignForm } from '../lib/campaign-preparation.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const campaignId = '22222222-2222-4222-8222-222222222222'
const packageId = '33333333-3333-4333-8333-333333333333'

const access = {
  operator: { subject: 'operator:warison' },
  tenants: [{
    tenantId,
    displayName: 'Rosa VIP Calçados',
    role: 'owner',
    permissions: ['view_workspace', 'manage_campaign_preparation'],
    membershipId: '44444444-4444-4444-8444-444444444444',
  }],
  boundaries: {
    tenantAccessDerivedFromMembership: true,
    publicationAuthorized: false,
    externalWritesAllowed: false,
    externalWritesPerformed: false,
  },
}

const context = {
  packageId,
  tenantId,
  campaignId,
  version: 1,
  schemaVersion: '1.0',
  status: 'needs_information',
  facts: {
    businessName: {
      value: 'Rosa VIP', source: 'user_input', evidenceRefs: ['api:user_input'],
      recordedAt: '2026-08-24T16:00:00.000Z',
    },
  },
  inferences: [],
  validationIssues: [{
    code: 'required_fact_missing', field: 'offer', severity: 'blocker',
    message: 'Oferta ausente', nextAction: 'Informe a oferta.',
  }],
  contentHash: 'a'.repeat(64),
  createdAt: '2026-08-24T16:00:00.000Z',
}

const contexts = {
  tenantId,
  contexts: [context],
  boundaries: {
    tenantAccessVerified: true,
    latestContextPerCampaign: true,
    publicationAuthorized: false,
    externalWritesAllowed: false,
    externalWritesPerformed: false,
  },
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

test('loads only campaign contexts from the authenticated tenant', async () => {
  const requests = []
  const result = await loadCampaignPreparation({
    requestedTenantId: tenantId,
    requestedCampaignId: campaignId,
    apiBaseUrl: 'https://api.test',
    operatorToken: 'server-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return url.endsWith('/v1/operator/tenants') ? response(access) : response(contexts)
    },
  })
  assert.equal(result.kind, 'ready')
  assert.equal(result.selectedContext.campaignId, campaignId)
  assert.equal(result.canEdit, true)
  assert.equal(requests[1].options.headers.authorization, 'Bearer server-secret')
})

test('refuses a context whose tenant does not match the authenticated selection', async () => {
  const crossed = {
    ...contexts,
    contexts: [{ ...context, tenantId: '55555555-5555-4555-8555-555555555555' }],
  }
  const result = await loadCampaignPreparation({
    requestedTenantId: tenantId,
    apiBaseUrl: 'https://api.test',
    operatorToken: 'server-secret',
    fetchImpl: async (url) => url.endsWith('/tenants') ? response(access) : response(crossed),
  })
  assert.deepEqual(result, { kind: 'unavailable' })
})

test('refuses an unknown campaign instead of guessing another context', async () => {
  const result = await loadCampaignPreparation({
    requestedTenantId: tenantId,
    requestedCampaignId: '66666666-6666-4666-8666-666666666666',
    apiBaseUrl: 'https://api.test',
    operatorToken: 'server-secret',
    fetchImpl: async (url) => url.endsWith('/tenants') ? response(access) : response(contexts),
  })
  assert.equal(result.kind, 'invalid_selection')
})

test('converts friendly budget input to integer minor units without floating point guessing', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('businessName', ' Rosa VIP ')
  form.set('budgetMode', 'daily')
  form.set('budgetAmount', '12,50')
  form.set('durationDays', '7')
  const result = parseCampaignForm(form)
  assert.equal(result.ok, true)
  assert.deepEqual(result.facts.budget, {
    mode: 'daily', amountMinor: 1250, currency: 'BRL',
  })
  assert.equal(result.facts.businessName, 'Rosa VIP')
  assert.equal(result.facts.durationDays, 7)
})

test('keeps partial progress but rejects ambiguous partial budget data', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('businessName', 'Rosa VIP')
  form.set('budgetAmount', '12,00')
  const result = parseCampaignForm(form)
  assert.equal(result.ok, false)
  assert.match(result.error, /tipo e o valor/)
  assert.equal(result.values.businessName, 'Rosa VIP')
})
