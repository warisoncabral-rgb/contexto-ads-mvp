const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES = new Set(['owner', 'operator', 'viewer'])
const PLAN_STATUSES = new Set([
  'draft', 'pending', 'blocked', 'ready_for_approval', 'approved', 'executing',
])

function validTenant(tenant) {
  return tenant
    && UUID_PATTERN.test(tenant.tenantId)
    && typeof tenant.displayName === 'string'
    && tenant.displayName.length > 0
    && ROLES.has(tenant.role)
    && Array.isArray(tenant.permissions)
    && UUID_PATTERN.test(tenant.membershipId)
}

function validAccess(payload) {
  return payload
    && typeof payload.operator?.subject === 'string'
    && Array.isArray(payload.tenants)
    && payload.tenants.every(validTenant)
    && payload.boundaries?.tenantAccessDerivedFromMembership === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
}

function validPlan(plan, tenantId) {
  return plan
    && plan.tenantId === tenantId
    && UUID_PATTERN.test(plan.campaignId)
    && UUID_PATTERN.test(plan.executionPlanId)
    && PLAN_STATUSES.has(plan.status)
    && Number.isSafeInteger(plan.campaignPackageVersion)
    && plan.campaignPackageVersion > 0
    && Number.isSafeInteger(plan.maximumPlannedSpendMinor)
    && plan.maximumPlannedSpendMinor >= 0
    && typeof plan.currency === 'string'
    && !Number.isNaN(Date.parse(plan.createdAt))
}

function validPlanList(payload, tenantId) {
  return payload
    && payload.tenantId === tenantId
    && Array.isArray(payload.plans)
    && payload.plans.every((plan) => validPlan(plan, tenantId))
    && payload.boundaries?.tenantAccessVerified === true
    && payload.boundaries?.latestPlanPerCampaign === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
}

async function safeFetch(url, token, fetchImpl) {
  return fetchImpl(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(5000),
  })
}

export async function loadOperatorWorkspace({
  requestedTenantId = '',
  requestedExecutionPlanId = '',
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  const base = apiBaseUrl.replace(/\/$/, '')

  try {
    const accessResponse = await safeFetch(`${base}/v1/operator/tenants`, operatorToken, fetchImpl)
    if (accessResponse.status === 401 || accessResponse.status === 403) {
      return { kind: 'access_denied' }
    }
    if (!accessResponse.ok) return { kind: 'unavailable' }
    const access = await accessResponse.json()
    if (!validAccess(access)) return { kind: 'unavailable' }
    if (access.tenants.length === 0) return { kind: 'no_tenants', access }

    const selectedTenant = access.tenants.find(
      (tenant) => tenant.tenantId === requestedTenantId,
    ) ?? (requestedTenantId ? null : access.tenants[0])
    if (!selectedTenant) return { kind: 'invalid_selection', access }

    const plansResponse = await safeFetch(
      `${base}/v1/operator/tenants/${encodeURIComponent(selectedTenant.tenantId)}/plans`,
      operatorToken,
      fetchImpl,
    )
    if (plansResponse.status === 401 || plansResponse.status === 403) {
      return { kind: 'access_denied' }
    }
    if (!plansResponse.ok) return { kind: 'unavailable' }
    const planList = await plansResponse.json()
    if (!validPlanList(planList, selectedTenant.tenantId)) return { kind: 'unavailable' }

    const selectedPlan = planList.plans.find(
      (plan) => plan.executionPlanId === requestedExecutionPlanId,
    ) ?? (requestedExecutionPlanId ? null : planList.plans[0])
    if (requestedExecutionPlanId && !selectedPlan) {
      return { kind: 'invalid_selection', access, selectedTenant, plans: planList.plans }
    }

    return {
      kind: 'ready',
      access,
      selectedTenant,
      plans: planList.plans,
      selectedPlan,
    }
  } catch {
    return { kind: 'unavailable' }
  }
}
