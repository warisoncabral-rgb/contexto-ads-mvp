import assert from 'node:assert/strict'
import test from 'node:test'
import { loadExecutorWorkspace, parseExecutorAction, validExecutionAuthorization,
  validManifest, validPreflight, validProtocol } from '../lib/executor-preflight.mjs'

const plan = { tenantId: '11111111-1111-4111-8111-111111111111', campaignId: '22222222-2222-4222-8222-222222222222', executionPlanId: '33333333-3333-4333-8333-333333333333', planHash: 'a'.repeat(64) }
const manifest = { executionManifestId: '44444444-4444-4444-8444-444444444444', ...plan, readinessDecisionId: '55555555-5555-4555-8555-555555555555', simulationId: '66666666-6666-4666-8666-666666666666', manifestHash: 'b'.repeat(64), status: 'prepared_gate_closed', operations: [{ order: 1, operationKey: 'campaign:create', idempotencyKey: 'c'.repeat(64), requestFingerprint: 'd'.repeat(64), internalObjectId: '77777777-7777-4777-8777-777777777777', objectType: 'campaign', action: 'create', dependsOnOperationKeys: [], intendedLifecycleStatus: 'PAUSED', effectState: 'not_started', executionAllowed: false, preconditions: [], recovery: {} }], executionGate: { status: 'closed', reason: 'write_path_not_validated_or_enabled', requirements: [] }, boundaries: { executable: false, campaignPublished: false, campaignActive: false, campaignDelivering: false, externalWritesAllowed: false, externalWritesPerformed: false }, generatedAt: '2026-08-24T18:00:00.000Z' }
const authorization = { executionAuthorizationId: '88888888-8888-4888-8888-888888888888', ...plan, executionManifestId: manifest.executionManifestId, manifestHash: manifest.manifestHash, actionType: 'authorize_controlled_paused_creation', riskLevel: 'high', scope: [], requestedBy: 'operator:warison', status: 'approved', expiresAt: '2026-08-24T18:15:00.000Z', correlationId: '99999999-9999-4999-8999-999999999999', boundaries: { effectiveExecutionPermission: false, externalWritesAllowed: false, externalWritesPerformed: false }, createdAt: '2026-08-24T18:00:00.000Z', updatedAt: '2026-08-24T18:00:00.000Z' }

test('accepts only a closed manifest bound to the exact selected plan', () => {
  assert.equal(validManifest(manifest, plan), true)
  assert.equal(validManifest({ ...manifest, planHash: 'f'.repeat(64) }, plan), false)
  assert.equal(validManifest({ ...manifest, boundaries: { ...manifest.boundaries, executable: true } }, plan), false)
})

test('keeps authorization separate from effective execution permission', () => {
  assert.equal(validExecutionAuthorization(authorization, manifest), true)
  assert.equal(validExecutionAuthorization({ ...authorization, boundaries: { ...authorization.boundaries, effectiveExecutionPermission: true } }, manifest), false)
})

test('loads executor evidence only through tenant-scoped server authentication', async () => {
  const urls = []
  const killSwitch = { tenantId: plan.tenantId, campaignId: plan.campaignId, writesBlocked: true, decision: 'blocked_missing_state', tenant: { known: false, status: 'missing' }, campaign: { known: false, status: 'missing' }, boundaries: { externalWritesAllowed: false, externalWritesPerformed: false }, evaluatedAt: '2026-08-24T18:00:00.000Z' }
  const fetchImpl = async (url, options) => { urls.push({ url, options }); if (url.endsWith('/execution-manifests/latest')) return { ok: true, status: 200, json: async () => manifest }; if (url.endsWith('/kill-switch/effective')) return { ok: true, status: 200, json: async () => killSwitch }; if (url.endsWith('/latest')) return { ok: false, status: 404 }; return { ok: true, status: 200, json: async () => authorization } }
  const result = await loadExecutorWorkspace({ plan, executionAuthorizationId: authorization.executionAuthorizationId, apiBaseUrl: 'https://api.test/', operatorToken: 'secret', fetchImpl })
  assert.equal(result.kind, 'ready')
  assert.equal(result.authorization.status, 'approved')
  assert.equal(result.killSwitch.writesBlocked, true)
  assert.equal(urls.every(({ url }) => url.includes(`/v1/operator/tenants/${plan.tenantId}/`)), true)
  assert.equal(urls.every(({ options }) => options.headers.authorization === 'Bearer secret'), true)
})

test('parses critical controls without accepting client-supplied actor identity', () => {
  const form = new FormData()
  for (const key of ['tenantId', 'campaignId', 'executionPlanId']) form.set(key, plan[key])
  form.set('executionManifestId', manifest.executionManifestId)
  form.set('executionAuthorizationId', authorization.executionAuthorizationId)
  form.set('executorAction', 'change_switch'); form.set('scope', 'campaign'); form.set('status', 'released'); form.set('reason', 'Teste controlado')
  const parsed = parseExecutorAction(form)
  assert.equal(parsed.ok, true)
  assert.equal('changedBy' in parsed, false)
  form.set('scope', 'global')
  assert.equal(parseExecutorAction(form).ok, false)
})

test('accepts only blocked preflight with no attempt or external effect', () => {
  const value = { executionPreflightId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...plan, executionManifestId: manifest.executionManifestId, executionAuthorizationId: authorization.executionAuthorizationId, planHash: plan.planHash, manifestHash: manifest.manifestHash, preflightHash: 'e'.repeat(64), status: 'blocked_before_attempt', checks: [{ key: 'write_adapter_enabled', status: 'blocked', evidenceRefs: [], meaning: 'Adapter ausente.' }], blockers: ['write_adapter_enabled'], nextAction: 'Manter bloqueado.', boundaries: { executionRecordCreated: false, externalAttemptStarted: false, campaignPublished: false, campaignActive: false, campaignDelivering: false, externalWritesAllowed: false, externalWritesPerformed: false }, generatedAt: '2026-08-24T18:00:00.000Z' }
  assert.equal(validPreflight(value, { ...manifest, executionAuthorizationId: authorization.executionAuthorizationId }), true)
  assert.equal(validPreflight({ ...value, boundaries: { ...value.boundaries, externalAttemptStarted: true } }, { ...manifest, executionAuthorizationId: authorization.executionAuthorizationId }), false)
})

test('requires all eleven external evidences while keeping protocol non-executable', () => {
  const requiredEvidence = Array.from({ length: 11 }, (_, index) => ({ key: `evidence_${index}`, status: 'required_not_collected', source: 'real_meta_environment', evidenceRefs: [] }))
  const protocol = { metaWriteValidationProtocolId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ...plan, executionManifestId: manifest.executionManifestId, manifestHash: manifest.manifestHash, protocolHash: 'f'.repeat(64), version: 1, mode: 'controlled_paused_creation', status: 'prepared_external_validation_required', preparedBy: 'operator:warison', operations: [], limits: { exactOperationCount: 1, allowedActions: ['create'], requiredLifecycleStatus: 'PAUSED', activationAllowed: false, deliveryAllowed: false, budgetIncreaseAllowed: false, automaticRetryAllowed: false, concurrentAttemptAllowed: false }, requiredEvidence, boundaries: { protocolIsExecutionCommand: false, executionRecordCreated: false, externalAttemptStarted: false, realMetaWriteValidated: false, writeAdapterEnabled: false, externalWritesAllowed: false, externalWritesPerformed: false }, preparedAt: '2026-08-24T18:00:00.000Z' }
  assert.equal(validProtocol(protocol, manifest), true)
  assert.equal(validProtocol({ ...protocol, requiredEvidence: requiredEvidence.slice(1) }, manifest), false)
})
