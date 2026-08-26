const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPES = ['business', 'ad_account', 'facebook_page', 'instagram_account', 'whatsapp']

function validExternalId(assetType, externalId) {
  return assetType === 'ad_account' ? /^act_\d+$/.test(externalId) : /^\d+$/.test(externalId)
}

export function parseMetaAssetSelection(formData) {
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  const connectionId = String(formData.get('connectionId') ?? '').trim()
  if (!UUID.test(tenantId) || !UUID.test(connectionId)) return { ok: false }
  const assets = TYPES.flatMap((assetType) => {
    const externalId = String(formData.get(`asset_${assetType}`) ?? '').trim()
    return externalId ? [{ assetType, externalId }] : []
  })
  if (!assets.some((asset) => asset.assetType === 'ad_account')
    || assets.some((asset) => !validExternalId(asset.assetType, asset.externalId))) {
    return { ok: false }
  }
  return { ok: true, tenantId, connectionId, assets }
}

export function validMetaAssetSnapshot(value, expected) {
  if (!value || typeof value !== 'object'
    || value.tenantId !== expected.tenantId
    || value.connectionId !== expected.connectionId
    || !Array.isArray(value.assets)
    || value.boundaries?.discoverySnapshotOnly !== true
    || value.boundaries?.externalWritesAllowed !== false
    || value.boundaries?.externalWritesPerformed !== false) return false
  const seen = new Set()
  return value.assets.every((asset) => {
    if (!asset || typeof asset !== 'object'
      || asset.tenantId !== expected.tenantId
      || asset.connectionId !== expected.connectionId
      || !TYPES.includes(asset.assetType)
      || typeof asset.externalId !== 'string'
      || !validExternalId(asset.assetType, asset.externalId)
      || typeof asset.selected !== 'boolean'
      || (asset.displayName !== undefined
        && (typeof asset.displayName !== 'string' || asset.displayName.length > 255))
      || typeof asset.observedAt !== 'string' || Number.isNaN(Date.parse(asset.observedAt))) return false
    const key = `${asset.assetType}:${asset.externalId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function selectedMetaAssetsMatch(snapshot, expectedAssets) {
  const selected = snapshot.assets.filter((asset) => asset.selected)
  const expected = new Set(expectedAssets.map((asset) => `${asset.assetType}:${asset.externalId}`))
  return selected.length === expected.size
    && selected.every((asset) => expected.has(`${asset.assetType}:${asset.externalId}`))
}

export async function loadMetaAssets({
  tenantId,
  connectionId,
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = fetch,
}) {
  if (!UUID.test(tenantId) || !UUID.test(connectionId)) return { kind: 'invalid' }
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration' }
  let response
  try {
    response = await fetchImpl(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(tenantId)}`
        + `/meta/connections/${encodeURIComponent(connectionId)}/assets`,
      {
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(65000),
      },
    )
  } catch { return { kind: 'unavailable' } }
  if (!response.ok) return { kind: 'denied' }
  let assets
  try { assets = await response.json() } catch { return { kind: 'invalid-response' } }
  const snapshot = {
    tenantId,
    connectionId,
    assets,
    boundaries: {
      discoverySnapshotOnly: true,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
  }
  return validMetaAssetSnapshot(snapshot, { tenantId, connectionId })
    ? { kind: 'ready', assets: snapshot.assets.map((asset) => ({
      assetType: asset.assetType,
      externalId: asset.externalId,
      ...(asset.displayName ? { displayName: asset.displayName } : {}),
      selected: asset.selected,
      observedAt: asset.observedAt,
    })) }
    : { kind: 'invalid-response' }
}
