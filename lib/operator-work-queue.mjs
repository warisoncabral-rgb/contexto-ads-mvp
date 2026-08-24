const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const OWNERS = new Set(['system', 'operator', 'meta_environment'])
const PRIORITIES = new Set(['critical', 'high', 'normal'])
const SOURCES = new Set(['operational_blocker', 'readiness_not_evaluated'])
const ROLES = new Set(['owner', 'operator', 'viewer'])
const CHANGE_KINDS = new Set(['entered', 'worsened', 'improved', 'unchanged', 'resolved'])
const SNAPSHOT_SOURCES = new Set(['campaign_plans', 'operational_readiness', 'execution_lifecycle', 'delivery_metrics'])

function validRefs(refs) {
  return Array.isArray(refs) && refs.every((ref) => typeof ref === 'string' && ref.trim().length > 0)
    && new Set(refs).size === refs.length
}

function validItem(item) {
  return item && SHA.test(item.workItemId) && UUID.test(item.tenantId)
    && UUID.test(item.campaignId) && UUID.test(item.executionPlanId)
    && typeof item.tenantDisplayName === 'string' && item.tenantDisplayName.length > 0
    && ROLES.has(item.role) && SOURCES.has(item.source) && OWNERS.has(item.owner)
    && PRIORITIES.has(item.priority) && typeof item.blockerCode === 'string' && item.blockerCode.length > 0
    && typeof item.meaning === 'string' && typeof item.nextAction === 'string'
    && validRefs(item.evidenceRefs)
    && !Number.isNaN(Date.parse(item.observedAt))
}

function validChange(change, snapshot) {
  return change && SHA.test(change.workItemId) && change.tenantId === snapshot.tenantId
    && UUID.test(change.campaignId) && UUID.test(change.executionPlanId)
    && typeof change.tenantDisplayName === 'string' && change.tenantDisplayName.length > 0
    && typeof change.blockerCode === 'string' && change.blockerCode.length > 0 && CHANGE_KINDS.has(change.kind)
    && (change.previousPriority === null || PRIORITIES.has(change.previousPriority))
    && (change.currentPriority === null || PRIORITIES.has(change.currentPriority))
    && typeof change.meaning === 'string' && validRefs(change.evidenceRefs)
    && (change.previousQueueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(change.previousQueueDate))
    && change.currentQueueDate === snapshot.queueDate
}

function validSnapshot(snapshot) {
  const statuses = new Set(['included', 'deferred', 'ignored'])
  const comparison = snapshot?.comparison
  const sourceDecisions = snapshot?.sourceDecisions
  const sourceNames = Array.isArray(sourceDecisions) ? sourceDecisions.map((decision) => decision.source) : []
  const validComparison = comparison && typeof comparison.baselineAvailable === 'boolean'
    && (comparison.previousQueueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(comparison.previousQueueDate))
    && Array.isArray(comparison.changes) && comparison.changes.every((change) => validChange(change, snapshot))
    && new Set(comparison.changes.map((change) => change.workItemId)).size === comparison.changes.length
    && (comparison.baselineAvailable || (comparison.previousQueueDate === null && comparison.changes.length === 0))
  return snapshot && UUID.test(snapshot.snapshotId) && UUID.test(snapshot.tenantId)
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.queueDate) && snapshot.calendarBasis === 'UTC'
    && SHA.test(snapshot.snapshotHash) && Number.isSafeInteger(snapshot.itemCount)
    && snapshot.itemCount >= 0 && Array.isArray(sourceDecisions)
    && sourceDecisions.length === SNAPSHOT_SOURCES.size
    && new Set(sourceNames).size === SNAPSHOT_SOURCES.size
    && sourceNames.every((source) => SNAPSHOT_SOURCES.has(source))
    && sourceDecisions.every((decision) => statuses.has(decision.status)
      && typeof decision.reason === 'string' && decision.reason.trim().length > 0)
    && validComparison
    && !Number.isNaN(Date.parse(snapshot.generatedAt))
}

export function validWorkQueue(payload) {
  const summary = payload?.summary
  const items = payload?.items
  const snapshots = payload?.snapshots
  const snapshotTenantIds = Array.isArray(snapshots) ? snapshots.map((snapshot) => snapshot.tenantId) : []
  const snapshotTenantSet = new Set(snapshotTenantIds)
  const workItemIds = Array.isArray(items) ? items.map((item) => item.workItemId) : []
  const tenantItemCounts = new Map(snapshotTenantIds.map((tenantId) => [tenantId, 0]))
  if (Array.isArray(items)) for (const item of items) {
    if (snapshotTenantSet.has(item.tenantId)) tenantItemCounts.set(item.tenantId, tenantItemCounts.get(item.tenantId) + 1)
  }
  return payload && Array.isArray(items) && items.every(validItem)
    && new Set(workItemIds).size === workItemIds.length
    && Array.isArray(snapshots) && snapshots.every(validSnapshot)
    && snapshotTenantSet.size === snapshotTenantIds.length
    && items.every((item) => snapshotTenantSet.has(item.tenantId))
    && snapshots.every((snapshot) => snapshot.itemCount === tenantItemCounts.get(snapshot.tenantId))
    && summary && ['authorizedTenantCount', 'pendingItemCount', 'criticalCount',
      'operatorCount', 'systemCount', 'metaEnvironmentCount']
      .every((key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0)
    && summary.authorizedTenantCount === snapshots.length
    && summary.pendingItemCount === items.length
    && summary.criticalCount === items.filter((item) => item.priority === 'critical').length
    && summary.operatorCount === items.filter((item) => item.owner === 'operator').length
    && summary.systemCount === items.filter((item) => item.owner === 'system').length
    && summary.metaEnvironmentCount === items.filter((item) => item.owner === 'meta_environment').length
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
  } catch { return { kind: 'unavailable' }
  }
}
