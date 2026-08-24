const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validTenantAccess(payload) {
  return payload && Array.isArray(payload.tenants)
    && payload.boundaries?.tenantAccessDerivedFromMembership === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
    && payload.tenants.every((tenant) => UUID.test(tenant?.tenantId)
      && typeof tenant.displayName === 'string'
      && ['owner', 'operator', 'viewer'].includes(tenant.role)
      && Array.isArray(tenant.permissions))
}

export function validConnectionStart(payload, tenantId) {
  return payload?.tenantId === tenantId && UUID.test(payload?.connectionId)
    && payload?.provider === 'meta' && payload?.status === 'authorization_pending'
    && payload?.externalWritePerformed === false
}

export function validOAuthStart(payload, connectionId) {
  if (payload?.connectionId !== connectionId || payload?.scopeProfile !== 'read_only'
    || payload?.writeAuthorized !== false || payload?.externalCallPerformed !== false) return false
  if (JSON.stringify(payload?.requestedScopes) !== JSON.stringify(['public_profile', 'ads_read', 'pages_show_list'])) return false
  try {
    const url = new URL(payload.authorizationUrl)
    return url.origin === 'https://www.facebook.com'
      && url.searchParams.get('scope') === 'public_profile,ads_read,pages_show_list'
      && typeof url.searchParams.get('state') === 'string'
  } catch { return false }
}

export function validReadOnlySmokeReport(payload, tenantId, connectionId) {
  const allowedSteps = ['identity', 'asset_discovery', 'capability_validation', 'ad_account_read']
  return UUID.test(payload?.smokeTestId) && payload?.tenantId === tenantId
    && payload?.connectionId === connectionId && typeof payload?.passed === 'boolean'
    && Array.isArray(payload?.blockers) && Array.isArray(payload?.steps)
    && payload.steps.length === 4
    && payload.steps.every((step) => allowedSteps.includes(step?.key)
      && ['passed', 'blocked'].includes(step?.status)
      && typeof step?.meaning === 'string' && Array.isArray(step?.evidenceRefs))
    && typeof payload?.generatedAt === 'string' && !Number.isNaN(Date.parse(payload.generatedAt))
}

export async function loadMetaConnectionSetup(requestedTenantId = '') {
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  let response
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants`, {
      headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch { return { kind: 'unavailable' } }
  if (response.status === 401 || response.status === 403) return { kind: 'access_denied' }
  if (!response.ok) return { kind: 'unavailable' }
  let access
  try { access = await response.json() } catch { return { kind: 'unavailable' } }
  if (!validTenantAccess(access)) return { kind: 'unavailable' }
  const owners = access.tenants.filter((tenant) => tenant.role === 'owner' && tenant.permissions.includes('configure_tenant'))
  if (!owners.length) return { kind: 'no_configurable_tenants' }
  const selectedTenant = requestedTenantId
    ? owners.find((tenant) => tenant.tenantId === requestedTenantId)
    : owners[0]
  if (!selectedTenant) return { kind: 'invalid_selection' }
  return { kind: 'ready', tenants: owners, selectedTenant }
}
