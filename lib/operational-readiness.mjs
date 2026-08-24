const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_STATUSES = new Set(['blocked', 'action_required', 'ready_for_executor_validation'])
const PROGRESS_VALUES = {
  campaignPreparation: new Set(['complete', 'incomplete']),
  metaEnvironmentValidation: new Set(['complete', 'pending']),
  creativeApproval: new Set(['complete', 'pending']),
  humanPlanApproval: new Set(['complete', 'pending']),
  executorValidation: new Set(['pending']),
  publication: new Set(['not_started']),
  activation: new Set(['not_started']),
  delivery: new Set(['not_started']),
}

function validProgress(progress) {
  return progress && Object.entries(PROGRESS_VALUES)
    .every(([key, allowed]) => allowed.has(progress[key]))
}

function validBlocker(blocker) {
  return blocker
    && typeof blocker.code === 'string'
    && ['system', 'operator', 'meta_environment'].includes(blocker.owner)
    && typeof blocker.meaning === 'string'
    && typeof blocker.nextAction === 'string'
    && Array.isArray(blocker.evidenceRefs)
    && blocker.evidenceRefs.every((reference) => typeof reference === 'string')
}

function validBasis(basis) {
  return basis
    && typeof basis.decision === 'string'
    && typeof basis.why === 'string'
    && Array.isArray(basis.evidenceRefs)
    && basis.evidenceRefs.every((reference) => typeof reference === 'string')
}

function validDecision(decision, tenantId, executionPlanId) {
  return decision
    && decision.tenantId === tenantId
    && decision.executionPlanId === executionPlanId
    && ALLOWED_STATUSES.has(decision.status)
    && typeof decision.headline === 'string'
    && typeof decision.plainLanguageSummary === 'string'
    && typeof decision.decisionHash === 'string'
    && typeof decision.nextAction === 'string'
    && typeof decision.generatedAt === 'string'
    && !Number.isNaN(Date.parse(decision.generatedAt))
    && Array.isArray(decision.blockers)
    && decision.blockers.every(validBlocker)
    && Array.isArray(decision.decisionBasis)
    && decision.decisionBasis.every(validBasis)
    && validProgress(decision.progress)
    && typeof decision.financialScope?.currency === 'string'
    && Number.isSafeInteger(decision.financialScope?.maximumPlannedSpendMinor)
    && decision.financialScope.maximumPlannedSpendMinor >= 0
    && typeof decision.financialScope?.calculation === 'string'
    && ['A0', 'A1', 'A2', 'A3', 'A4'].includes(decision.autonomy?.level)
    && typeof decision.autonomy?.humanApprovalRequired === 'boolean'
    && decision.boundaries?.campaignPublished === false
    && decision.boundaries?.campaignActive === false
    && decision.boundaries?.campaignDelivering === false
    && decision.boundaries?.externalWritesAllowed === false
    && decision.boundaries?.externalWritesPerformed === false
}

export function validateOperationalQuery(tenantId, executionPlanId) {
  if (!tenantId && !executionPlanId) return { kind: 'empty' }
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(executionPlanId)) {
    return {
      kind: 'invalid',
      message: 'Tenant e plano precisam ser identificadores UUID válidos.',
    }
  }
  return { kind: 'valid' }
}

export async function loadOperationalReadiness({
  tenantId,
  executionPlanId,
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  fetchImpl = globalThis.fetch,
}) {
  const query = validateOperationalQuery(tenantId, executionPlanId)
  if (query.kind !== 'valid') return query
  if (!apiBaseUrl) return { kind: 'configuration_required' }

  const base = apiBaseUrl.replace(/\/$/, '')
  const url = `${base}/v1/plans/${encodeURIComponent(executionPlanId)}`
    + `/readiness-decisions/latest?tenantId=${encodeURIComponent(tenantId)}`

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(5000),
    })
    if (response.status === 404) return { kind: 'not_found' }
    if (!response.ok) return { kind: 'unavailable' }
    const decision = await response.json()
    if (!validDecision(decision, tenantId, executionPlanId)) {
      return { kind: 'unavailable' }
    }
    return { kind: 'ready', decision }
  } catch {
    return { kind: 'unavailable' }
  }
}
