const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES = new Set(['owner', 'operator', 'viewer'])
const READINESS = new Set(['blocked', 'action_required', 'not_evaluated', 'ready_for_executor_validation'])
const PLANS = new Set(['draft', 'pending', 'blocked', 'ready_for_approval', 'approved', 'executing'])

function validItem(item) {
  return item && UUID.test(item.tenantId) && UUID.test(item.campaignId)
    && UUID.test(item.executionPlanId) && typeof item.tenantDisplayName === 'string'
    && item.tenantDisplayName.length > 0 && ROLES.has(item.role)
    && PLANS.has(item.planStatus) && READINESS.has(item.readinessStatus)
    && typeof item.headline === 'string' && typeof item.nextAction === 'string'
    && Number.isSafeInteger(item.blockerCount) && item.blockerCount >= 0
    && Number.isSafeInteger(item.maximumPlannedSpendMinor) && item.maximumPlannedSpendMinor >= 0
    && typeof item.currency === 'string' && !Number.isNaN(Date.parse(item.updatedAt))
}

export function validPortfolio(payload) {
  const summary = payload?.summary
  return payload && Array.isArray(payload.items) && payload.items.every(validItem)
    && summary && ['authorizedTenantCount', 'campaignCount', 'blockedCount',
      'actionRequiredCount', 'readyCount', 'notEvaluatedCount']
      .every((key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0)
    && summary.campaignCount === payload.items.length
    && payload.boundaries?.tenantAccessDerivedFromMembership === true
    && payload.boundaries?.latestPlanPerCampaign === true
    && payload.boundaries?.priorityRuleIsDeterministic === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
}

export async function loadOperatorPortfolio({
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/v1/operator/portfolio`, {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000),
    })
    if (response.status === 401 || response.status === 403) return { kind: 'access_denied' }
    if (!response.ok) return { kind: 'unavailable' }
    const portfolio = await response.json()
    return validPortfolio(portfolio) ? { kind: 'ready', portfolio } : { kind: 'unavailable' }
  } catch { return { kind: 'unavailable' } }
}
