'use server'

import { redirect } from 'next/navigation'
import { parseCampaignForm } from '../lib/campaign-preparation.mjs'
import { parsePlanGenerationForm, validGeneratedPlan } from '../lib/execution-plan-view.mjs'
import { parseApprovalAction, validApproval } from '../lib/plan-approval.mjs'
import { validOperationalDecision } from '../lib/operational-readiness.mjs'
import { parseCreativeForm, validCreativePackage } from '../lib/creative-media-center.mjs'
import { parseExecutorAction, validExecutionAuthorization, validManifest, validPreflight,
  validProtocol } from '../lib/executor-preflight.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/

export async function saveCampaignContext(_previousState, formData) {
  const parsed = parseCampaignForm(formData)
  if (!parsed.ok) return { error: parsed.error, values: parsed.values }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central ainda não está conectada ao backend seguro.', values: parsed.values }
  }
  const base = apiBaseUrl.replace(/\/$/, '')
  const path = parsed.values.campaignId
    ? `/v1/operator/tenants/${encodeURIComponent(parsed.values.tenantId)}`
      + `/campaign-contexts/${encodeURIComponent(parsed.values.campaignId)}/versions`
    : `/v1/operator/tenants/${encodeURIComponent(parsed.values.tenantId)}/campaign-contexts`

  let response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ facts: parsed.facts }),
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch {
    return {
      error: 'Não foi possível salvar agora. O progresso anterior permanece preservado.',
      values: parsed.values,
    }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: 'Seu acesso não permite alterar esta campanha.', values: parsed.values }
  }
  if (!response.ok) {
    return { error: 'Os dados não foram aceitos. Revise os campos e tente novamente.', values: parsed.values }
  }
  let context
  try {
    context = await response.json()
  } catch {
    return { error: 'O backend não confirmou o salvamento de forma válida.', values: parsed.values }
  }
  if (context.tenantId !== parsed.values.tenantId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(context.campaignId)
    || !['needs_information', 'ready_for_generation'].includes(context.status)
    || context.boundaries?.externalWritesAllowed === true) {
    return { error: 'O backend retornou uma confirmação inconsistente. Nada foi assumido.', values: parsed.values }
  }
  redirect(`/campaigns?tenantId=${encodeURIComponent(context.tenantId)}`
    + `&campaignId=${encodeURIComponent(context.campaignId)}&saved=1`)
}

export async function generateExecutionPlan(_previousState, formData) {
  const parsed = parsePlanGenerationForm(formData)
  if (!parsed.ok) return { error: parsed.error }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central ainda não está conectada ao backend seguro.' }
  }
  const base = apiBaseUrl.replace(/\/$/, '')
  let response
  try {
    response = await fetch(
      `${base}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/campaigns/${encodeURIComponent(parsed.campaignId)}/plans`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ contextVersion: parsed.contextVersion }),
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(8000),
      },
    )
  } catch {
    return { error: 'Não foi possível gerar o plano agora. Nenhuma execução foi iniciada.' }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: 'Seu acesso não permite gerar o plano desta campanha.' }
  }
  if (response.status === 409) {
    return { error: 'O contexto ainda possui pendências e não pode gerar um plano.' }
  }
  if (!response.ok) return { error: 'O backend não conseguiu gerar um plano seguro.' }
  let plan
  try {
    plan = await response.json()
  } catch {
    return { error: 'O backend não confirmou o plano de forma válida.' }
  }
  if (!validGeneratedPlan(plan, parsed)) {
    return { error: 'O plano retornado não respeitou todas as travas e foi recusado.' }
  }
  return { plan }
}

export async function changePlanApproval(_previousState, formData) {
  const parsed = parseApprovalAction(formData)
  if (!parsed.ok) return { error: parsed.error }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) return { error: 'A central não está conectada ao backend seguro.' }
  const base = apiBaseUrl.replace(/\/$/, '')
  const requestPath = `/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
    + `/campaigns/${encodeURIComponent(parsed.campaignId)}/plans/${encodeURIComponent(parsed.executionPlanId)}/approvals`
  const decisionPath = `/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
    + `/approvals/${encodeURIComponent(parsed.approvalId)}/${parsed.decision}`
  let response
  try {
    response = await fetch(`${base}${parsed.decision === 'request' ? requestPath : decisionPath}`, {
      method: 'POST', headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(parsed.reason ? { reason: parsed.reason } : {}), cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch { return { error: 'Não foi possível registrar a decisão. Nada foi liberado.' } }
  if (response.status === 401 || response.status === 403) return { error: 'Seu papel não permite esta ação.' }
  if (!response.ok) return { error: 'A decisão foi recusada com segurança pelo backend.' }
  let result
  try { result = await response.json() } catch { return { error: 'O backend não confirmou a decisão.' } }
  const expected = {
    tenantId: parsed.tenantId, campaignId: parsed.campaignId,
    executionPlanId: parsed.executionPlanId,
    planHash: String(formData.get('planHash') ?? ''),
    maximumPlannedSpendMinor: Number(formData.get('maximumPlannedSpendMinor')),
    currency: String(formData.get('currency') ?? ''),
  }
  const approval = result?.approval
  if (!validApproval(approval, expected)
    || !validOperationalDecision(result?.readiness, parsed.tenantId, parsed.executionPlanId)
    || result.boundaries?.approvalIsExecutionAuthorization !== false
    || result.boundaries?.publicationAuthorized !== false
    || result.boundaries?.externalWritesAllowed !== false
    || result.boundaries?.externalWritesPerformed !== false) {
    return { error: 'A confirmação operacional não corresponde ao plano revisado.' }
  }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}&executionPlanId=${encodeURIComponent(parsed.executionPlanId)}&approvalId=${encodeURIComponent(approval.approvalId)}`)
}

export async function changeCreativePackage(_previousState, formData) {
  const parsed = parseCreativeForm(formData)
  if (!parsed.ok) return { error: parsed.error }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central não está conectada ao backend seguro. Nada foi publicado.' }
  }
  const scope = `/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
    + `/campaigns/${encodeURIComponent(parsed.campaignId)}`
  const path = parsed.action === 'create'
    ? `${scope}/plans/${encodeURIComponent(parsed.executionPlanId)}/creative-packages`
    : `${scope}/creative-packages/${parsed.version}/approve`
  const body = parsed.action === 'create'
    ? { creative: parsed.creative }
    : { contentHash: parsed.contentHash }
  let response
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch {
    return { error: 'Não foi possível registrar o criativo. Nada foi publicado ou ativado.' }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: 'Seu papel não permite esta ação criativa.' }
  }
  if (response.status === 409) {
    return { error: 'A versão ou o hash mudou. Recarregue antes de aprovar; nada foi liberado.' }
  }
  if (!response.ok) return { error: 'O backend recusou o criativo com segurança.' }
  let result
  try { result = await response.json() } catch {
    return { error: 'O backend não confirmou o criativo de forma válida.' }
  }
  const plan = result?.executionPlan
  if (!validCreativePackage(result?.creativePackage, parsed)
    || plan?.tenantId !== parsed.tenantId || plan?.campaignId !== parsed.campaignId
    || !UUID.test(plan?.executionPlanId) || !SHA.test(plan?.planHash)
    || plan?.approvalRequired !== true || plan?.externalWritesAllowed !== false
    || !validOperationalDecision(result?.readiness, parsed.tenantId, plan?.executionPlanId)
    || result.boundaries?.creativeApprovalIsPlanApproval !== false
    || result.boundaries?.publicationAuthorized !== false
    || result.boundaries?.externalWritesAllowed !== false
    || result.boundaries?.externalWritesPerformed !== false) {
    return { error: 'A confirmação criativa ficou inconsistente e foi recusada. Nada foi publicado.' }
  }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}`
    + `&executionPlanId=${encodeURIComponent(plan.executionPlanId)}`)
}

export async function changeExecutorControl(_previousState, formData) {
  const parsed = parseExecutorAction(formData)
  if (!parsed.ok) return { error: parsed.error }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) return { error: 'A central não está conectada ao backend seguro.' }
  const base = apiBaseUrl.replace(/\/$/, '')
  const tenant = `/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
  const routes = {
    prepare_manifest: `${tenant}/campaigns/${encodeURIComponent(parsed.campaignId)}/plans/${encodeURIComponent(parsed.executionPlanId)}/execution-manifests`,
    request_authorization: `${tenant}/execution-manifests/${encodeURIComponent(parsed.executionManifestId)}/authorizations`,
    approve: `${tenant}/execution-authorizations/${encodeURIComponent(parsed.executionAuthorizationId)}/approve`,
    reject: `${tenant}/execution-authorizations/${encodeURIComponent(parsed.executionAuthorizationId)}/reject`,
    revoke: `${tenant}/execution-authorizations/${encodeURIComponent(parsed.executionAuthorizationId)}/revoke`,
    preflight: `${tenant}/execution-authorizations/${encodeURIComponent(parsed.executionAuthorizationId)}/preflights`,
    change_switch: `${tenant}/kill-switch/${parsed.scope}`,
    prepare_protocol: `${tenant}/execution-manifests/${encodeURIComponent(parsed.executionManifestId)}/meta-write-validation-protocols`,
  }
  const bodies = {
    prepare_manifest: parsed.approvalId ? { approvalId: parsed.approvalId } : {},
    request_authorization: {}, approve: {}, preflight: {}, prepare_protocol: {},
    reject: { reason: parsed.reason }, revoke: { reason: parsed.reason },
    change_switch: { ...(parsed.scope === 'campaign' ? { campaignId: parsed.campaignId } : {}),
      status: parsed.status, reason: parsed.reason },
  }
  let response
  try {
    response = await fetch(`${base}${routes[parsed.executorAction]}`, {
      method: 'POST', headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodies[parsed.executorAction]), cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch { return { error: 'Não foi possível validar o executor. Nenhuma tentativa externa começou.' } }
  if ([401, 403].includes(response.status)) return { error: 'Seu papel não permite esta ação.' }
  if (response.status === 409) return { error: 'O estado mudou ou expirou. Recarregue antes de decidir.' }
  if (!response.ok) return { error: 'O backend bloqueou a ação com segurança.' }
  let result
  try { result = await response.json() } catch { return { error: 'O backend não confirmou a ação.' } }
  const expectedPlan = { tenantId: parsed.tenantId, campaignId: parsed.campaignId,
    executionPlanId: parsed.executionPlanId, planHash: String(formData.get('planHash') ?? '') }
  const expectedManifest = { ...expectedPlan, executionManifestId: parsed.executionManifestId,
    manifestHash: String(formData.get('manifestHash') ?? '') }
  if (parsed.executorAction === 'prepare_manifest' && !validManifest(result, expectedPlan)) {
    return { error: 'O manifesto retornado não corresponde ao plano exato.' }
  }
  if (['request_authorization', 'approve', 'reject', 'revoke'].includes(parsed.executorAction)
    && !validExecutionAuthorization(result, expectedManifest)) {
    return { error: 'A autorização retornada não corresponde ao manifesto exato.' }
  }
  if (parsed.executorAction === 'prepare_protocol' && !validProtocol(result, expectedManifest)) {
    return { error: 'O protocolo retornado não preservou todas as travas.' }
  }
  if (parsed.executorAction === 'change_switch'
    && (result?.tenantId !== parsed.tenantId || result?.scope !== parsed.scope
      || result?.status !== parsed.status || !UUID.test(result?.killSwitchStateId))) {
    return { error: 'O estado de segurança retornado ficou inconsistente.' }
  }
  if (parsed.executorAction === 'preflight') {
    const expected = { ...expectedManifest, executionAuthorizationId: parsed.executionAuthorizationId }
    return validPreflight(result, expected)
      ? { error: '', preflight: result }
      : { error: 'O diagnóstico retornado ficou inconsistente; nada foi iniciado.' }
  }
  const manifestId = result.executionManifestId ?? parsed.executionManifestId
  const authorizationId = result.executionAuthorizationId ?? parsed.executionAuthorizationId
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}`
    + `&executionPlanId=${encodeURIComponent(parsed.executionPlanId)}`
    + `${parsed.approvalId ? `&approvalId=${encodeURIComponent(parsed.approvalId)}` : ''}`
    + `${manifestId ? `&executionManifestId=${encodeURIComponent(manifestId)}` : ''}`
    + `${authorizationId ? `&executionAuthorizationId=${encodeURIComponent(authorizationId)}` : ''}`)
}
