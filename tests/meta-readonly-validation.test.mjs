import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseMetaValidationInput,
  validReadOnlySmokeReport,
} from '../lib/meta-readonly-validation.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'

test('accepts only UUID-scoped Meta validation input', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('connectionId', connectionId)
  assert.deepEqual(parseMetaValidationInput(form), { ok: true, tenantId, connectionId })
  form.set('connectionId', '../other')
  assert.deepEqual(parseMetaValidationInput(form), { ok: false })
})

test('accepts a tenant-bound sanitized read-only smoke report', () => {
  const report = {
    smokeTestId: '33333333-3333-4333-8333-333333333333',
    tenantId,
    connectionId,
    passed: true,
    steps: ['identity', 'asset_discovery', 'capability_validation', 'ad_account_read'].map((key) => ({
      key,
      status: 'passed',
      meaning: 'Verificação confirmada.',
      evidenceRefs: [`meta:${key}`],
    })),
    blockers: [],
    generatedAt: '2026-08-25T22:00:00.000Z',
  }
  assert.equal(validReadOnlySmokeReport(report, { tenantId, connectionId }), true)
  assert.equal(validReadOnlySmokeReport(
    { ...report, tenantId: '44444444-4444-4444-8444-444444444444' },
    { tenantId, connectionId },
  ), false)
})

test('rejects duplicate, unknown, or secret-bearing result shapes', () => {
  const base = {
    smokeTestId: '33333333-3333-4333-8333-333333333333',
    tenantId,
    connectionId,
    passed: false,
    blockers: ['meta_identity_validation_failed'],
    generatedAt: '2026-08-25T22:00:00.000Z',
  }
  const step = {
    key: 'identity',
    status: 'blocked',
    meaning: 'Identidade não confirmada.',
    evidenceRefs: [],
  }
  assert.equal(validReadOnlySmokeReport({ ...base, steps: [step, step] }, base), false)
  assert.equal(validReadOnlySmokeReport({
    ...base,
    steps: [{ ...step, key: 'token_exchange', accessToken: 'secret' }],
  }, base), false)
  assert.equal(validReadOnlySmokeReport({ ...base, passed: true, blockers: [], steps: [step] }, base), false)
})
