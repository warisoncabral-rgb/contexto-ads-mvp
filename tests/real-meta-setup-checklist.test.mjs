import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRealMetaSetupChecklist } from '../lib/real-meta-setup-checklist.mjs'

test('keeps ads_management out of the first read-only smoke', () => {
  const checklist = summarizeRealMetaSetupChecklist()
  assert.equal(checklist.readOnlySmoke.some((item) => item.key === 'ads_management'), false)
  assert.equal(checklist.controlledWriteLater.some((item) => item.key === 'ads_management'), true)
  assert.equal(checklist.boundaries.adsManagementRequiredForReadOnlySmoke, false)
  assert.equal(checklist.boundaries.externalWriteEnabled, false)
})

test('contains no secret values, only configuration requirements', () => {
  const checklist = summarizeRealMetaSetupChecklist()
  const text = JSON.stringify(checklist)
  assert.equal(text.includes('access_token'), false)
  assert.equal(text.includes('appsecret_proof'), false)
  assert.equal(checklist.boundaries.realCredentialsStoredInChecklist, false)
})
