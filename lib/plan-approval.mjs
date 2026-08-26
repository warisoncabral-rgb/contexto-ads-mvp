const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set(['pending', 'approved', 'rejected', 'expired', 'revoked', 'invalidated'])

export function validApproval(value, expected) {
  return value && UUID.test(value.approvalId)
    && value.tenantId === expected.tenantId
    && value.executionPlanId === expected.executionPlanId
    && value.campaignId === expected.campaignId
    && value.approvedPlanHash === expected.planHash
    && STATUSES.has(value.status)
    && Array.isArray(value.scope)
    && value.scope.includes(`plan_hash:${expected.planHash}`)
    && value.scope.includes(`maximum_spend_minor:${expected.maximumPlannedSpendMinor}`)
    && value.scope.includes(`currency:${expected.currency}`)
    && value.scope.includes('external_write:false')
    && typeof value.requestedBy === 'string'
    && !Number.isNaN(Date.parse(value.createdAt))
}

export async function loadPlanApproval({ approvalId, plan, apiBaseUrl, operatorToken,
  fetchImpl = globalThis.fetch }) {
  if (!approvalId) return { kind: 'none' }
  if (!UUID.test(approvalId) || !apiBaseUrl || !operatorToken) return { kind: 'invalid' }
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(plan.tenantId)}/approvals/${encodeURIComponent(approvalId)}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000),
    })
    if (!response.ok) return { kind: response.status === 401 || response.status === 403 ? 'denied' : 'unavailable' }
    const approval = await response.json()
    return validApproval(approval, plan) ? { kind: 'ready', approval } : { kind: 'invalid' }
  } catch { return { kind: 'unavailable' } }
}

export function parseApprovalAction(formData) {
  const values = Object.fromEntries(['tenantId', 'campaignId', 'executionPlanId', 'approvalId', 'decision', 'reason']
    .map((key) => [key, String(formData.get(key) ?? '').trim()]))
  if (!UUID.test(values.tenantId) || !UUID.test(values.campaignId)
    || !UUID.test(values.executionPlanId) || (values.approvalId && !UUID.test(values.approvalId))) {
    return { ok: false, error: 'Escopo de aprovação inválido.' }
  }
  if (!['request', 'approve', 'reject', 'revoke'].includes(values.decision)) {
    return { ok: false, error: 'Decisão de aprovação inválida.' }
  }
  if (values.decision !== 'request' && !values.approvalId) return { ok: false, error: 'Aprovação ausente.' }
  if (['reject', 'revoke'].includes(values.decision) && values.reason.length < 3) {
    return { ok: false, error: 'Informe um motivo objetivo.' }
  }
  return { ok: true, ...values }
}
