'use server'

import { redirect } from 'next/navigation'
import { parseCampaignForm } from '../lib/campaign-preparation.mjs'
import { parsePlanGenerationForm, validGeneratedPlan } from '../lib/execution-plan-view.mjs'
import { parseApprovalAction, validApproval } from '../lib/plan-approval.mjs'
import {
  parseReadinessEvaluation,
  validOperationalDecision,
} from '../lib/operational-readiness.mjs'
import {
  parseCreativeForm,
  validCreativeMutationEnvelope,
} from '../lib/creative-media-center.mjs'
import {
  parseMetaValidationInput,
  validReadOnlySmokeReport,
} from '../lib/meta-readonly-validation.mjs'
import {
  parseMetaAssetSelection,
  selectedMetaAssetsMatch,
  validMetaAssetSnapshot,
} from '../lib/meta-assets.mjs'
import { parseExecutorAction, validExecutionAuthorization, validManifest, validPreflight,
  validProtocol } from '../lib/executor-preflight.mjs'
import { parseExecutionTargetBinding, validBoundExecutionPlan } from '../lib/meta-execution-target.mjs'
import {
  parseExecutionCapabilityValidation,
  validExecutionCapabilitySnapshot,
} from '../lib/meta-execution-capabilities.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/

export async function startMetaAuthorization(formData) {
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  if (!UUID.test(tenantId)) redirect('/integrations/meta?error=tenant')
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) redirect('/integrations/meta?error=configuration')

  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(tenantId)}`
        + '/meta/connections/start-oauth',
      {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(15000),
      },
    )
  } catch {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=backend`)
  }
  if (response.status === 401 || response.status === 403) {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=access`)
  }
  if (!response.ok) {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=oauth`)
  }

  let result
  try { result = await response.json() } catch {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  let authorizationUrl
  try { authorizationUrl = new URL(result.authorizationUrl) } catch {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  if (authorizationUrl.protocol !== 'https:'
    || authorizationUrl.hostname !== 'www.facebook.com'
    || !/^\/v\d+\.\d+\/dialog\/oauth$/.test(authorizationUrl.pathname)
    || !UUID.test(result.connectionId)
    || result.boundaries?.requestedScopesAreReadOnly !== true
    || result.boundaries?.externalWritesAllowed !== false
    || result.boundaries?.externalWritesPerformed !== false) {
    redirect(`/integrations/meta?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  redirect(authorizationUrl.toString())
}

export async function requestMetaAdsManagement(formData) {
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  const connectionId = String(formData.get('connectionId') ?? '').trim()
  if (!UUID.test(tenantId) || !UUID.test(connectionId)) redirect('/?error=scope')
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) redirect('/?error=configuration')

  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(tenantId)}`
        + `/meta/connections/${encodeURIComponent(connectionId)}/request-ads-management`,
      {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(15000),
      },
    )
  } catch {
    redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=backend`)
  }
  if ([401, 403].includes(response.status)) {
    redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=access`)
  }
  if (!response.ok) redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=oauth`)

  let result
  try { result = await response.json() } catch {
    redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  let authorizationUrl
  try { authorizationUrl = new URL(result.authorizationUrl) } catch {
    redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  if (authorizationUrl.protocol !== 'https:'
    || authorizationUrl.hostname !== 'www.facebook.com'
    || !/^\/v\d+\.\d+\/dialog\/oauth$/.test(authorizationUrl.pathname)
    || result.connectionId !== connectionId
    || result.boundaries?.requestedPermission !== 'ads_management'
    || result.boundaries?.publicationAuthorized !== false
    || result.boundaries?.externalWritesAllowed !== false
    || result.boundaries?.externalWritesPerformed !== false) {
    redirect(`/?tenantId=${encodeURIComponent(tenantId)}&error=response`)
  }
  redirect(authorizationUrl.toString())
}

export async function runMetaReadOnlyValidation(_previousState, formData) {
  const parsed = parseMetaValidationInput(formData)
  if (!parsed.ok) return { error: 'A conexão informada é inválida.', report: null }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central ainda não está conectada ao backend seguro.', report: null }
  }

  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/meta/connections/${encodeURIComponent(parsed.connectionId)}/smoke-test`,
      {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(65000),
      },
    )
  } catch {
    return { error: 'A Meta ou o backend não respondeu a tempo. Nenhuma escrita foi realizada.', report: null }
  }
  if ([401, 403].includes(response.status)) {
    return { error: 'Seu acesso não permite validar esta conexão.', report: null }
  }
  if (response.status === 404) {
    return { error: 'A conexão autorizada não foi localizada no backend.', report: null }
  }
  if (response.status === 409) {
    return { error: 'A conexão existe, mas ainda não está pronta para a validação.', report: null }
  }
  if (response.status >= 500) {
    return { error: 'O backend encontrou uma falha interna durante a validação.', report: null }
  }
  if (!response.ok) {
    return { error: 'A validação foi interrompida com segurança pelo backend.', report: null }
  }

  let report
  try { report = await response.json() } catch {
    return { error: 'O backend não devolveu uma evidência válida.', report: null }
  }
  if (!validReadOnlySmokeReport(report, parsed)) {
    return { error: 'A evidência retornada não corresponde à conexão solicitada.', report: null }
  }
  return {
    error: '',
    report: {
      passed: report.passed,
      steps: report.steps.map(({ key, status, meaning }) => ({ key, status, meaning })),
      blockers: [...report.blockers],
    },
  }
}

export async function selectMetaAssets(_previousState, formData) {
  const parsed = parseMetaAssetSelection(formData)
  if (!parsed.ok) return { error: 'Selecione uma conta de anúncios válida.', selectedAssets: [] }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central ainda não está conectada ao backend seguro.', selectedAssets: [] }
  }
  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/meta/connections/${encodeURIComponent(parsed.connectionId)}/assets/selection`,
      {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json' },
        body: JSON.stringify({ assets: parsed.assets }),
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(65000),
      },
    )
  } catch {
    return { error: 'O backend não respondeu a tempo. Nenhuma seleção foi alterada.', selectedAssets: [] }
  }
  if ([401, 403].includes(response.status)) {
    return { error: 'Seu acesso não permite vincular estes ativos.', selectedAssets: [] }
  }
  if (!response.ok) {
    return { error: 'O backend recusou a seleção com segurança.', selectedAssets: [] }
  }
  let snapshot
  try { snapshot = await response.json() } catch {
    return { error: 'O backend não confirmou a seleção.', selectedAssets: [] }
  }
  if (!validMetaAssetSnapshot(snapshot, parsed)) {
    return { error: 'A seleção retornada não corresponde à conexão solicitada.', selectedAssets: [] }
  }
  if (!selectedMetaAssetsMatch(snapshot, parsed.assets)) {
    return { error: 'O backend não confirmou todos os ativos escolhidos.', selectedAssets: [] }
  }
  const selectedAssets = snapshot.assets.filter((asset) => asset.selected).map(
    ({ assetType, externalId, displayName }) => ({
      assetType, externalId, ...(displayName ? { displayName } : {}),
    }),
  )
  return { error: '', selectedAssets }
}

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

export async function bindSelectedExecutionTarget(_previousState, formData) {
  const parsed = parseExecutionTargetBinding(formData)
  if (!parsed.ok) return { error: parsed.error }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) return { error: 'A central não está conectada ao backend seguro.' }
  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/campaigns/${encodeURIComponent(parsed.campaignId)}/plans/`
        + `${encodeURIComponent(parsed.executionPlanId)}/target`,
      { method: 'POST', headers: { accept: 'application/json',
        authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId: parsed.connectionId, adAccountId: parsed.adAccountId }),
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(8000) },
    )
  } catch { return { error: 'Não foi possível vincular a conta agora. Nenhuma escrita foi iniciada.' } }
  if ([401, 403].includes(response.status)) return { error: 'Seu acesso não permite vincular esta conta.' }
  if ([404, 409].includes(response.status)) {
    return { error: 'A seleção ou o plano mudou. Recarregue a integração antes de continuar.' }
  }
  if (!response.ok) return { error: 'O backend recusou o vínculo com segurança.' }
  let plan
  try { plan = await response.json() } catch { return { error: 'O backend não confirmou o novo plano.' } }
  if (!validBoundExecutionPlan(plan, parsed)) {
    return { error: 'O vínculo retornado não corresponde ao plano e foi recusado.' }
  }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}`
    + `&executionPlanId=${encodeURIComponent(plan.executionPlanId)}`)
}

export async function recalculateOperationalReadiness(_previousState, formData) {
  const parsed = parseReadinessEvaluation(formData)
  if (!parsed.ok) return { error: 'O escopo do plano é inválido.' }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central não está conectada ao backend seguro.' }
  }
  let response
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/campaigns/${encodeURIComponent(parsed.campaignId)}/plans/`
        + `${encodeURIComponent(parsed.executionPlanId)}/readiness`,
      { method: 'POST', headers: { accept: 'application/json',
        authorization: `Bearer ${operatorToken}` }, cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000) },
    )
  } catch {
    return { error: 'Não foi possível calcular a prontidão agora. Nenhuma escrita externa ocorreu.' }
  }
  if ([401, 403].includes(response.status)) {
    return { error: 'Seu papel não permite calcular a prontidão.' }
  }
  if (!response.ok) return { error: 'O backend bloqueou o cálculo com segurança.' }
  let decision
  try { decision = await response.json() } catch {
    return { error: 'O backend não devolveu uma decisão verificável.' }
  }
  if (!validOperationalDecision(decision, parsed.tenantId, parsed.executionPlanId)) {
    return { error: 'A decisão não corresponde ao plano selecionado.' }
  }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}`
    + `&executionPlanId=${encodeURIComponent(parsed.executionPlanId)}`)
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
  if (!validCreativeMutationEnvelope(result, parsed)
    || !validOperationalDecision(result?.readiness, parsed.tenantId, plan?.executionPlanId)
  ) {
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

export async function validateMetaExecutionCapabilities(_previousState, formData) {
  const parsed = parseExecutionCapabilityValidation(formData)
  if (!parsed.ok) return { error: 'O plano ou a conexão informada é inválida.' }
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) {
    return { error: 'A central não está conectada ao backend seguro.' }
  }
  const base = apiBaseUrl.replace(/\/$/, '')
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${operatorToken}`,
    'content-type': 'application/json',
  }
  let response
  try {
    response = await fetch(
      `${base}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/meta/connections/${encodeURIComponent(parsed.connectionId)}`
        + '/capabilities/validate-execution',
      {
        method: 'POST', headers, body: '{}', cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(15000),
      },
    )
  } catch {
    return { error: 'A Meta ou o backend não respondeu. Nenhuma escrita foi realizada.' }
  }
  if ([401, 403].includes(response.status)) {
    return { error: 'Seu acesso não permite validar esta conexão.' }
  }
  if (!response.ok) {
    return { error: 'A validação foi interrompida com segurança; nenhuma permissão foi alterada.' }
  }
  let snapshot
  try { snapshot = await response.json() } catch {
    return { error: 'O backend não devolveu uma evidência válida.' }
  }
  if (!validExecutionCapabilitySnapshot(snapshot, parsed)) {
    return { error: 'A evidência de capacidade ficou inconsistente e foi recusada.' }
  }

  let readinessResponse
  try {
    readinessResponse = await fetch(
      `${base}/v1/operator/tenants/${encodeURIComponent(parsed.tenantId)}`
        + `/campaigns/${encodeURIComponent(parsed.campaignId)}`
        + `/plans/${encodeURIComponent(parsed.executionPlanId)}/readiness`,
      {
        method: 'POST', headers,
        body: JSON.stringify({ approvalId: parsed.approvalId }),
        cache: 'no-store', signal: globalThis.AbortSignal.timeout(15000),
      },
    )
  } catch {
    return { error: 'As evidências foram salvas, mas a prontidão não pôde ser recalculada.' }
  }
  if (!readinessResponse.ok) {
    return { error: 'As evidências foram salvas, mas o plano recusou a atualização.' }
  }
  let decision
  try { decision = await readinessResponse.json() } catch {
    return { error: 'A atualização de prontidão não pôde ser confirmada.' }
  }
  if (!validOperationalDecision(decision, parsed.tenantId, parsed.executionPlanId)
    || decision.planHash !== parsed.planHash) {
    return { error: 'A prontidão retornada não corresponde ao hash aprovado.' }
  }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}`
    + `&executionPlanId=${encodeURIComponent(parsed.executionPlanId)}`
    + `&approvalId=${encodeURIComponent(parsed.approvalId)}`)
}
