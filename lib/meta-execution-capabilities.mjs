const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const TYPES = new Set([
  'DISCOVER_ASSETS', 'READ_AD_ACCOUNT', 'CREATE_CAMPAIGN', 'CREATE_ADSET',
  'CREATE_CREATIVE', 'CREATE_AD', 'CLICK_TO_WHATSAPP',
])
const STATUSES = new Set([
  'available', 'permission_missing', 'asset_missing', 'unsupported', 'unknown',
])

export function parseExecutionCapabilityValidation(formData) {
  const value = Object.fromEntries([
    'tenantId', 'campaignId', 'executionPlanId', 'connectionId', 'approvalId', 'planHash',
  ].map((key) => [key, String(formData.get(key) ?? '').trim()]))
  if (![value.tenantId, value.campaignId, value.executionPlanId,
    value.connectionId, value.approvalId].every((item) => UUID.test(item))
    || !SHA.test(value.planHash)) return { ok: false }
  return { ok: true, ...value }
}

export function validExecutionCapabilitySnapshot(value, expected) {
  return value?.success === true
    && value.validationMode === 'permission_and_asset_read_only'
    && Array.isArray(value.data)
    && value.data.every((record) => record
      && record.tenantId === expected.tenantId
      && record.connectionId === expected.connectionId
      && UUID.test(record.capabilityId)
      && TYPES.has(record.capabilityType)
      && STATUSES.has(record.status)
      && Array.isArray(record.requiredPermissions)
      && Array.isArray(record.grantedPermissions)
      && Array.isArray(record.restrictions)
      && typeof record.validationSource === 'string'
      && !Number.isNaN(Date.parse(record.validatedAt)))
    && value.boundaries?.permissionsChanged === false
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}
