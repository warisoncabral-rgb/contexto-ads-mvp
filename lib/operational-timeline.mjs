const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATEGORIES = new Set(['context', 'plan', 'creative', 'approval', 'readiness', 'executor', 'safety'])
const RESULTS = new Set(['success', 'failure', 'blocked', 'partial', 'info'])
const ACTORS = new Set(['Usuário autenticado', 'Sistema', 'Contexto Ads', 'Gerador', 'Analista', 'Adaptador Meta'])

export function validTimeline(value, plan) {
  return value && value.tenantId === plan.tenantId && value.campaignId === plan.campaignId
    && value.executionPlanId === plan.executionPlanId && Array.isArray(value.items)
    && value.items.length <= 100 && value.items.every((item) => UUID.test(item.auditEventId)
      && CATEGORIES.has(item.category) && typeof item.title === 'string'
      && typeof item.detail === 'string' && RESULTS.has(item.result) && ACTORS.has(item.actor)
      && /^[a-z_]+:[A-Za-z0-9:_-]+$/.test(item.evidenceRef)
      && !Number.isNaN(Date.parse(item.createdAt)))
    && value.boundaries?.sanitizedOperationalHistory === true
    && value.boundaries?.immutableAuditSource === true
    && value.boundaries?.secretsExposed === false
    && value.boundaries?.publicationAuthorized === false
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}

export async function loadOperationalTimeline({ plan, apiBaseUrl, operatorToken,
  fetchImpl = globalThis.fetch }) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  try {
    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(plan.tenantId)}`
      + `/campaigns/${encodeURIComponent(plan.campaignId)}/timeline?executionPlanId=${encodeURIComponent(plan.executionPlanId)}`
    const response = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000) })
    if (!response.ok) return { kind: [401, 403].includes(response.status) ? 'denied' : 'unavailable' }
    const timeline = await response.json()
    return validTimeline(timeline, plan) ? { kind: 'ready', timeline } : { kind: 'unavailable' }
  } catch { return { kind: 'unavailable' } }
}
