import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadOperationalReadiness,
  validateOperationalQuery,
} from '../lib/operational-readiness.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const executionPlanId = '22222222-2222-4222-8222-222222222222'

function decision(overrides = {}) {
  return {
    tenantId,
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId,
    status: 'action_required',
    decisionHash: 'a'.repeat(64),
    headline: 'Ação necessária',
    plainLanguageSummary: 'A campanha ainda não foi publicada.',
    nextAction: 'Revisar pendência.',
    blockers: [],
    decisionBasis: [],
    progress: {
      campaignPreparation: 'complete',
      metaEnvironmentValidation: 'pending',
      creativeApproval: 'pending',
      humanPlanApproval: 'pending',
      executorValidation: 'pending',
      publication: 'not_started',
      activation: 'not_started',
      delivery: 'not_started',
    },
    financialScope: {
      currency: 'BRL',
      maximumPlannedSpendMinor: 8400,
      calculation: '1200 x 7 dias',
    },
    autonomy: { level: 'A0', humanApprovalRequired: true },
    boundaries: {
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    generatedAt: '2026-08-24T14:00:00.000Z',
    ...overrides,
  }
}

test('keeps an empty query in a transparent empty state', () => {
  assert.deepEqual(validateOperationalQuery('', ''), { kind: 'empty' })
})

test('rejects malformed identifiers before calling the backend', async () => {
  let called = false
  const result = await loadOperationalReadiness({
    tenantId: 'bad',
    executionPlanId,
    apiBaseUrl: 'http://backend.test',
    fetchImpl: async () => { called = true },
  })
  assert.equal(result.kind, 'invalid')
  assert.equal(called, false)
})

test('requires explicit backend configuration', async () => {
  const result = await loadOperationalReadiness({ tenantId, executionPlanId, apiBaseUrl: '' })
  assert.deepEqual(result, { kind: 'configuration_required' })
})

test('loads only a matching fail-closed operational decision', async () => {
  let requestedUrl
  const result = await loadOperationalReadiness({
    tenantId,
    executionPlanId,
    apiBaseUrl: 'https://api.example.test/',
    fetchImpl: async (url, options) => {
      requestedUrl = url
      assert.equal(options.cache, 'no-store')
      return { ok: true, status: 200, json: async () => decision() }
    },
  })
  assert.equal(result.kind, 'ready')
  assert.equal(requestedUrl,
    `https://api.example.test/v1/plans/${executionPlanId}/readiness-decisions/latest?tenantId=${tenantId}`)
})

test('refuses payloads that claim an external state not proven by the contract', async () => {
  const result = await loadOperationalReadiness({
    tenantId,
    executionPlanId,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => decision({
        boundaries: {
          ...decision().boundaries,
          campaignPublished: true,
        },
      }),
    }),
  })
  assert.deepEqual(result, { kind: 'unavailable' })
})

test('refuses incomplete progress or malformed evidence instead of guessing', async () => {
  const result = await loadOperationalReadiness({
    tenantId,
    executionPlanId,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => decision({ progress: { campaignPreparation: 'complete' } }),
    }),
  })
  assert.deepEqual(result, { kind: 'unavailable' })
})

test('does not expose backend error payloads', async () => {
  const missing = await loadOperationalReadiness({
    tenantId,
    executionPlanId,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  })
  assert.deepEqual(missing, { kind: 'not_found' })

  const failure = await loadOperationalReadiness({
    tenantId,
    executionPlanId,
    apiBaseUrl: 'https://api.example.test',
    fetchImpl: async () => ({ ok: false, status: 500 }),
  })
  assert.deepEqual(failure, { kind: 'unavailable' })
})
