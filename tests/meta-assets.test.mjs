import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadMetaAssets,
  parseMetaAssetSelection,
  selectedMetaAssetsMatch,
  validMetaAssetSnapshot,
} from '../lib/meta-assets.mjs'

const tenantId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'

test('parses one ad account and optional discovered asset types', () => {
  const form = new FormData()
  form.set('tenantId', tenantId)
  form.set('connectionId', connectionId)
  form.set('asset_ad_account', 'act_123')
  form.set('asset_facebook_page', '456')
  assert.deepEqual(parseMetaAssetSelection(form), {
    ok: true, tenantId, connectionId,
    assets: [
      { assetType: 'ad_account', externalId: 'act_123' },
      { assetType: 'facebook_page', externalId: '456' },
    ],
  })
  form.delete('asset_ad_account')
  assert.deepEqual(parseMetaAssetSelection(form), { ok: false })
})

test('accepts only a tenant-bound and fail-closed asset snapshot', () => {
  const snapshot = {
    tenantId,
    connectionId,
    assets: [{
      tenantId, connectionId, assetType: 'ad_account', externalId: 'act_123',
      displayName: 'Main account', selected: true, observedAt: '2026-08-25T22:00:00.000Z',
    }],
    boundaries: {
      discoverySnapshotOnly: true,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
  }
  assert.equal(validMetaAssetSnapshot(snapshot, { tenantId, connectionId }), true)
  assert.equal(validMetaAssetSnapshot({ ...snapshot,
    boundaries: { ...snapshot.boundaries, externalWritesPerformed: true },
  }, { tenantId, connectionId }), false)
  assert.equal(validMetaAssetSnapshot({ ...snapshot, tenantId: connectionId },
    { tenantId, connectionId }), false)
  assert.equal(selectedMetaAssetsMatch(snapshot, [
    { assetType: 'ad_account', externalId: 'act_123' },
  ]), true)
  assert.equal(selectedMetaAssetsMatch(snapshot, [
    { assetType: 'ad_account', externalId: 'act_999' },
  ]), false)
})

test('loads assets with server-only authentication and rejects malformed responses', async () => {
  let authorization = ''
  const fetchImpl = async (_url, options) => {
    authorization = options.headers.authorization
    return { ok: true, json: async () => [{
      tenantId, connectionId, assetType: 'facebook_page', externalId: '456',
      displayName: 'WC Rosa Vip Calçados', selected: false,
      observedAt: '2026-08-25T22:00:00.000Z',
    }] }
  }
  await assert.doesNotReject(async () => {
    const result = await loadMetaAssets({ tenantId, connectionId,
      apiBaseUrl: 'https://api.example.test', operatorToken: 'server-secret', fetchImpl })
    assert.equal(result.kind, 'ready')
    assert.equal(JSON.stringify(result).includes('server-secret'), false)
  })
  assert.equal(authorization, 'Bearer server-secret')
})
