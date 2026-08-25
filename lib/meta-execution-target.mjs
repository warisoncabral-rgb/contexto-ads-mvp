const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validSelectedExecutionTarget(value, tenantId) {
  return value && value.tenantId === tenantId
    && UUID.test(value.connectionId)
    && /^act_\d+$/.test(value.adAccountId)
    && (value.displayName === undefined
      || (typeof value.displayName === 'string' && value.displayName.length <= 255))
    && Array.isArray(value.selectedAssets)
    && value.selectedAssets.some((asset) => asset.assetType === 'ad_account'
      && asset.externalId === value.adAccountId)
    && value.boundaries?.selectedDiscoverySnapshotOnly === true
    && value.boundaries?.credentialExposed === false
    && value.boundaries?.publicationAuthorized === false
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}

export async function loadSelectedExecutionTarget({
  tenantId,
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = fetch,
}) {
  if (!UUID.test(tenantId) || !apiBaseUrl || !operatorToken) return { kind: 'unavailable' }
  try {
    const response = await fetchImpl(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(tenantId)}`
        + '/meta/selected-execution-target',
      { headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store', signal: globalThis.AbortSignal.timeout(65000) },
    )
    if (response.status === 404) return { kind: 'not_connected' }
    if (response.status === 409) return { kind: 'not_selected' }
    if ([401, 403].includes(response.status)) return { kind: 'denied' }
    if (!response.ok) return { kind: 'unavailable' }
    const target = await response.json()
    return validSelectedExecutionTarget(target, tenantId)
      ? { kind: 'ready', target }
      : { kind: 'unavailable' }
  } catch { return { kind: 'unavailable' } }
}

export function parseExecutionTargetBinding(formData) {
  const values = Object.fromEntries(['tenantId', 'campaignId', 'executionPlanId',
    'connectionId', 'adAccountId'].map((key) => [key, String(formData.get(key) ?? '').trim()]))
  if (![values.tenantId, values.campaignId, values.executionPlanId, values.connectionId]
    .every((value) => UUID.test(value)) || !/^act_\d+$/.test(values.adAccountId)) {
    return { ok: false, error: 'O alvo Meta selecionado é inválido.' }
  }
  return { ok: true, ...values }
}

export function validBoundExecutionPlan(plan, expected) {
  return plan && plan.tenantId === expected.tenantId
    && plan.campaignId === expected.campaignId
    && UUID.test(plan.executionPlanId)
    && plan.executionPlanId !== expected.executionPlanId
    && plan.meta?.connectionId === expected.connectionId
    && plan.meta?.adAccountId === expected.adAccountId
    && Array.isArray(plan.meta.assetBindings)
    && plan.meta.assetBindings.includes(`ad_account:${expected.adAccountId}`)
    && /^[0-9a-f]{64}$/.test(plan.planHash)
    && plan.status === 'draft'
    && plan.autonomy?.approvalRequired === true
    && plan.externalEffects?.writesAllowed === false
    && plan.externalEffects?.writesPerformed === false
}
