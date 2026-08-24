import test from 'node:test'
import assert from 'node:assert/strict'
import { loadOperatorPortfolio, validPortfolio } from '../lib/operator-portfolio.mjs'

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const payload = {
  items: [{ tenantId: id('1'), tenantDisplayName: 'Rosa VIP', role: 'owner',
    campaignId: id('2'), executionPlanId: id('3'), planStatus: 'approved',
    readinessStatus: 'blocked', headline: 'Bloqueada', nextAction: 'Validar ambiente.',
    blockerCount: 1, maximumPlannedSpendMinor: 12000, currency: 'BRL',
    updatedAt: '2026-08-24T18:00:00.000Z' }],
  summary: { authorizedTenantCount: 1, campaignCount: 1, blockedCount: 1,
    actionRequiredCount: 0, readyCount: 0, notEvaluatedCount: 0 },
  boundaries: { tenantAccessDerivedFromMembership: true, latestPlanPerCampaign: true,
    priorityRuleIsDeterministic: true, publicationAuthorized: false,
    externalWritesAllowed: false, externalWritesPerformed: false },
  generatedAt: '2026-08-24T18:00:00.000Z',
}

test('accepts only a complete read-only portfolio contract', () => {
  assert.equal(validPortfolio(payload), true)
  assert.equal(validPortfolio({ ...payload, boundaries: { ...payload.boundaries, externalWritesAllowed: true } }), false)
  assert.equal(validPortfolio({ ...payload, items: [{ ...payload.items[0], tenantId: id('9') }], summary: { ...payload.summary, campaignCount: 2 } }), false)
})

test('loads portfolio with server-side bearer and no cache', async () => {
  let request
  const result = await loadOperatorPortfolio({ apiBaseUrl: 'https://api.example.test/', operatorToken: 'secret', fetchImpl: async (url, options) => {
    request = { url, options }; return { ok: true, status: 200, json: async () => payload }
  } })
  assert.equal(result.kind, 'ready')
  assert.equal(request.url, 'https://api.example.test/v1/operator/portfolio')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.equal(request.options.cache, 'no-store')
})

test('fails closed for missing configuration, denial, and malformed payload', async () => {
  assert.equal((await loadOperatorPortfolio({ apiBaseUrl: '', operatorToken: '' })).kind, 'configuration_required')
  assert.equal((await loadOperatorPortfolio({ apiBaseUrl: 'x', operatorToken: 'x', fetchImpl: async () => ({ ok: false, status: 403 }) })).kind, 'access_denied')
  assert.equal((await loadOperatorPortfolio({ apiBaseUrl: 'x', operatorToken: 'x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })).kind, 'unavailable')
})
