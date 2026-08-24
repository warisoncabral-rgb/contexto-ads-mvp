const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const OWNERS = new Set(['system', 'operator', 'meta_environment'])
const PRIORITIES = new Set(['critical', 'high', 'normal'])
const SOURCES = new Set(['operational_blocker', 'readiness_not_evaluated'])
const ROLES = new Set(['owner', 'operator', 'viewer'])

function validItem(item) {
  return item && SHA.test(item.workItemId) && UUID.test(item.tenantId)
    && UUID.test(item.campaignId) && UUID.test(item.executionPlanId)
    && typeof item.tenantDisplayName === 'string' && item.tenantDisplayName.length > 0
    && ROLES.has(item.role) && SOURCES.has(item.source) && OWNERS.has(item.owner)
    && PRIORITIES.has(item.priority) && typeof item.blockerCode === 'string'
    && typeof item.meaning === 'string' && typeof item.nextAction === 'string'
    && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === 'string')
    && !Number.isNaN(Date.parse(item.observedAt))
}

function validSnapshot(snapshot) {
  const statuses = new Set(['included', 'deferred', 'ignored'])
  const sources = new Set(['campaign_plans', 'operational_readiness', 'execution_lifecycle', 'delivery_metrics'])
  return snapshot && UUID.test(snapshot.snapshotId) && UUID.test(snapshot.tenantId)
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.queueDate) && snapshot.calendarBasis === 'UTC'
    && SHA.test(snapshot.snapshotHash) && Number.isSafeInteger(snapshot.itemCount)
    && snapshot.itemCount >= 0 && Array.isArray(snapshot.sourceDecisions)
    && snapshot.sourceDecisions.length === 4
    && snapshot.sourceDecisions.every((decision) => sources.has(decision.source)
      && statuses.has(decision.status) && typeof decision.reason === 'string'
      && decision.reason.length > 0)
    && !Number.isNaN(Date.parse(snapshot.generatedAt))
}

export function validWorkQueue(payload) {
  const summary = payload?.summary
  return payload && Array.isArray(payload.items) && payload.items.every(validItem)
    && Array.isArray(payload.snapshots) && payload.snapshots.every(validSnapshot)
    && summary && ['authorizedTenantCount', 'pendingItemCount', 'criticalCount',
      'operatorCount', 'systemCount', 'metaEnvironmentCount']
      .every((key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0)
    && summary.pendingItemCount === payload.items.length
    && payload.boundaries?.derivedFromCurrentReadiness === true
    && payload.boundaries?.tenantAccessDerivedFromMembership === true
    && payload.boundaries?.priorityRuleIsDeterministic === true
    && payload.boundaries?.deadlinesFabricated === false
    && payload.boundaries?.completionInferred === false
    && payload.boundaries?.dailySnapshotsPersisted === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
}

export async function loadOperatorWorkQueue({
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/v1/operator/work-queue`, {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000),
    })
    if (response.status === 401 || response.status === 403) return { kind: 'access_denied' }
    if (!response.ok) return { kind: 'unavailable' }
    const queue = await response.json()
    return validWorkQueue(queue) ? { kind: 'ready', queue } : { kind: 'unavailable' }
  } catch { return { kind: 'unavailable' } }
}
