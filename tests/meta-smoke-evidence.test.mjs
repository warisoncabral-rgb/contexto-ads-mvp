import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveMetaSmokeEvidencePacket, formatMetaSmokeEvidencePacket } from '../lib/meta-smoke-evidence.mjs'

const report = {
  smokeTestId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  connectionId: '33333333-3333-4333-8333-333333333333',
  passed: true,
  generatedAt: '2026-08-24T22:00:00.000Z',
  blockers: [],
  steps: [
    { key: 'identity', status: 'passed', meaning: 'ok', evidenceRefs: ['meta_identity:1'], observedAt: '2026-08-24T21:59:00.000Z' },
    { key: 'asset_discovery', status: 'passed', meaning: 'ok', evidenceRefs: ['asset_snapshot:1'] },
    { key: 'capability_validation', status: 'passed', meaning: 'ok', evidenceRefs: ['capability:1'] },
    { key: 'ad_account_read', status: 'passed', meaning: 'ok', evidenceRefs: ['ad_account:act_1'] },
  ],
}

test('derives a four-step evidence packet without inferring write permission', () => {
  const packet = deriveMetaSmokeEvidencePacket(report)
  assert.equal(packet.entries.length, 4)
  assert.equal(packet.evidenceReferenceCount, 4)
  assert.equal(packet.boundaries.evidenceSufficiencyInferred, false)
  assert.equal(packet.boundaries.externalWriteAuthorized, false)
})

test('fails closed when one expected smoke step is missing', () => {
  assert.equal(deriveMetaSmokeEvidencePacket({ ...report, steps: report.steps.slice(0, 3) }), null)
})

test('formats a sanitized review text without converting evidence into authorization', () => {
  const text = formatMetaSmokeEvidencePacket(deriveMetaSmokeEvidencePacket(report))
  assert.match(text, /Result: PASS/)
  assert.match(text, /identity: passed/)
  assert.match(text, /do not authorize Meta writes/)
})
