import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseExecutionCapabilityValidation,
  validExecutionCapabilitySnapshot,
} from '../lib/meta-execution-capabilities.mjs'

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333',
  connectionId: '44444444-4444-4444-8444-444444444444',
  approvalId: '55555555-5555-4555-8555-555555555555',
  planHash: 'a'.repeat(64),
}

test('parses an exact execution capability validation request', () => {
  const form = new FormData()
  Object.entries(input).forEach(([key, value]) => form.set(key, value))
  assert.deepEqual(parseExecutionCapabilityValidation(form), { ok: true, ...input })
  form.set('connectionId', '../me')
  assert.deepEqual(parseExecutionCapabilityValidation(form), { ok: false })
})

test('accepts only a read-only bounded capability snapshot', () => {
  const snapshot = {
    success: true,
    validationMode: 'permission_and_asset_read_only',
    data: [{
      capabilityId: '66666666-6666-4666-8666-666666666666',
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      capabilityType: 'CREATE_CAMPAIGN',
      requiredPermissions: ['ads_management'],
      grantedPermissions: [],
      status: 'permission_missing',
      restrictions: ['missing_permission:ads_management'],
      validationSource: 'meta_api',
      validatedAt: '2026-08-26T00:00:00.000Z',
    }],
    boundaries: {
      permissionsChanged: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
  }
  assert.equal(validExecutionCapabilitySnapshot(snapshot, input), true)
  assert.equal(validExecutionCapabilitySnapshot({
    ...snapshot,
    boundaries: { ...snapshot.boundaries, permissionsChanged: true },
  }, input), false)
})
