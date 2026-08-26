const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/

export function validManifest(value, plan) {
  return value && UUID.test(value.executionManifestId)
    && value.tenantId === plan.tenantId && value.campaignId === plan.campaignId
    && value.executionPlanId === plan.executionPlanId && value.planHash === plan.planHash
    && SHA.test(value.manifestHash) && value.status === 'prepared_gate_closed'
    && Array.isArray(value.operations) && value.operations.length > 0
    && value.operations.every((operation) => Number.isSafeInteger(operation.order)
      && typeof operation.operationKey === 'string' && SHA.test(operation.idempotencyKey)
      && SHA.test(operation.requestFingerprint) && operation.intendedLifecycleStatus === 'PAUSED'
      && operation.effectState === 'not_started' && operation.executionAllowed === false)
    && value.executionGate?.status === 'closed'
    && value.boundaries?.executable === false
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}

export function validExecutionAuthorization(value, manifest) {
  return value && UUID.test(value.executionAuthorizationId)
    && value.tenantId === manifest.tenantId && value.campaignId === manifest.campaignId
    && value.executionPlanId === manifest.executionPlanId
    && value.executionManifestId === manifest.executionManifestId
    && value.planHash === manifest.planHash && value.manifestHash === manifest.manifestHash
    && ['pending', 'approved', 'rejected', 'revoked', 'expired', 'invalidated'].includes(value.status)
    && value.actionType === 'authorize_controlled_paused_creation'
    && value.riskLevel === 'high' && Array.isArray(value.scope)
    && value.boundaries?.effectiveExecutionPermission === false
    && value.boundaries?.externalWritesAllowed === false
    && !Number.isNaN(Date.parse(value.expiresAt))
}

export function validKillSwitch(value, plan) {
  return value && value.tenantId === plan.tenantId && value.campaignId === plan.campaignId
    && typeof value.writesBlocked === 'boolean'
    && ['blocked_missing_state', 'blocked_engaged', 'released'].includes(value.decision)
    && [value.tenant, value.campaign].every((scope) => scope
      && typeof scope.known === 'boolean' && ['engaged', 'released', 'missing'].includes(scope.status))
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}

export function validProtocol(value, manifest) {
  return value && UUID.test(value.metaWriteValidationProtocolId)
    && value.tenantId === manifest.tenantId && value.campaignId === manifest.campaignId
    && value.executionPlanId === manifest.executionPlanId
    && value.executionManifestId === manifest.executionManifestId
    && value.planHash === manifest.planHash && value.manifestHash === manifest.manifestHash
    && SHA.test(value.protocolHash) && value.mode === 'controlled_paused_creation'
    && ['prepared_external_validation_required', 'external_validation_running',
      'external_validation_failed', 'external_validation_succeeded'].includes(value.status)
    && value.limits?.requiredLifecycleStatus === 'PAUSED'
    && value.limits?.activationAllowed === false && value.limits?.deliveryAllowed === false
    && Array.isArray(value.requiredEvidence) && value.requiredEvidence.length === 11
    && typeof value.boundaries?.protocolIsExecutionCommand === 'boolean'
    && typeof value.boundaries?.realMetaWriteValidated === 'boolean'
    && typeof value.boundaries?.externalWritesAllowed === 'boolean'
    && typeof value.boundaries?.externalWritesPerformed === 'boolean'
}

async function get(url, token, fetchImpl) {
  return fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000) })
}

export async function loadExecutorWorkspace({ plan, executionAuthorizationId = '', apiBaseUrl,
  operatorToken, fetchImpl = globalThis.fetch }) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  const base = apiBaseUrl.replace(/\/$/, '')
  const scope = `${base}/v1/operator/tenants/${encodeURIComponent(plan.tenantId)}`
  try {
    const manifestResponse = await get(`${scope}/plans/${encodeURIComponent(plan.executionPlanId)}/execution-manifests/latest`, operatorToken, fetchImpl)
    if (manifestResponse.status === 404) return { kind: 'none' }
    if (!manifestResponse.ok) return { kind: [401, 403].includes(manifestResponse.status) ? 'denied' : 'unavailable' }
    const manifest = await manifestResponse.json()
    if (!validManifest(manifest, plan)) return { kind: 'unavailable' }
    const requests = [
      get(`${scope}/campaigns/${encodeURIComponent(plan.campaignId)}/kill-switch/effective`, operatorToken, fetchImpl),
      get(`${scope}/execution-manifests/${encodeURIComponent(manifest.executionManifestId)}/meta-write-validation-protocols/latest`, operatorToken, fetchImpl),
      executionAuthorizationId && UUID.test(executionAuthorizationId)
        ? get(`${scope}/execution-authorizations/${encodeURIComponent(executionAuthorizationId)}`, operatorToken, fetchImpl) : null,
    ]
    const [switchResponse, protocolResponse, authorizationResponse] = await Promise.all(requests)
    const killSwitch = switchResponse.ok ? await switchResponse.json() : null
    const protocol = protocolResponse.ok ? await protocolResponse.json() : null
    const authorization = authorizationResponse?.ok ? await authorizationResponse.json() : null
    return {
      kind: 'ready', manifest,
      killSwitch: validKillSwitch(killSwitch, plan) ? killSwitch : null,
      protocol: validProtocol(protocol, manifest) ? protocol : null,
      authorization: validExecutionAuthorization(authorization, manifest) ? authorization : null,
    }
  } catch { return { kind: 'unavailable' } }
}

export function parseExecutorAction(formData) {
  const text = (key) => String(formData.get(key) ?? '').trim()
  const values = Object.fromEntries(['tenantId', 'campaignId', 'executionPlanId', 'executionManifestId',
    'executionAuthorizationId', 'approvalId', 'executorAction', 'reason', 'scope', 'status']
    .map((key) => [key, text(key)]))
  if (![values.tenantId, values.campaignId, values.executionPlanId].every((value) => UUID.test(value))) {
    return { ok: false, error: 'Escopo do executor inválido.' }
  }
  const actions = ['prepare_manifest', 'request_authorization', 'approve', 'reject', 'revoke',
    'preflight', 'change_switch', 'prepare_protocol', 'execute_paused']
  if (!actions.includes(values.executorAction)) return { ok: false, error: 'Ação do executor inválida.' }
  if (values.executorAction !== 'prepare_manifest' && !UUID.test(values.executionManifestId)) {
    return { ok: false, error: 'Manifesto de execução ausente.' }
  }
  if (['approve', 'reject', 'revoke', 'preflight', 'execute_paused'].includes(values.executorAction)
    && !UUID.test(values.executionAuthorizationId)) return { ok: false, error: 'Autorização ausente.' }
  if (['reject', 'revoke', 'change_switch'].includes(values.executorAction) && values.reason.length < 3) {
    return { ok: false, error: 'Informe um motivo objetivo.' }
  }
  if (values.executorAction === 'change_switch'
    && (!['tenant', 'campaign'].includes(values.scope) || !['engaged', 'released'].includes(values.status))) {
    return { ok: false, error: 'Estado do Kill Switch inválido.' }
  }
  return { ok: true, ...values }
}

export function validPreflight(value, expected) {
  return value && UUID.test(value.executionPreflightId)
    && value.tenantId === expected.tenantId && value.campaignId === expected.campaignId
    && value.executionPlanId === expected.executionPlanId
    && value.executionManifestId === expected.executionManifestId
    && value.executionAuthorizationId === expected.executionAuthorizationId
    && value.status === 'blocked_before_attempt' && Array.isArray(value.checks)
    && value.checks.every((check) => ['passed', 'blocked'].includes(check.status)
      && typeof check.meaning === 'string' && Array.isArray(check.evidenceRefs))
    && value.boundaries?.executionRecordCreated === false
    && value.boundaries?.externalAttemptStarted === false
    && value.boundaries?.externalWritesAllowed === false
    && value.boundaries?.externalWritesPerformed === false
}
