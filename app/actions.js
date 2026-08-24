'use server'

import { redirect } from 'next/navigation'
import { parseCampaignForm } from '../lib/campaign-preparation.mjs'
import { parsePlanGenerationForm, validGeneratedPlan } from '../lib/execution-plan-view.mjs'
import { parseApprovalAction, validApproval } from '../lib/plan-approval.mjs'

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
  let approval
  try { approval = await response.json() } catch { return { error: 'O backend não confirmou a decisão.' } }
  const expected = {
    tenantId: parsed.tenantId, campaignId: parsed.campaignId,
    executionPlanId: parsed.executionPlanId,
    planHash: String(formData.get('planHash') ?? ''),
    maximumPlannedSpendMinor: Number(formData.get('maximumPlannedSpendMinor')),
    currency: String(formData.get('currency') ?? ''),
  }
  if (!validApproval(approval, expected)) return { error: 'A confirmação não corresponde ao plano revisado.' }
  redirect(`/?tenantId=${encodeURIComponent(parsed.tenantId)}&executionPlanId=${encodeURIComponent(parsed.executionPlanId)}&approvalId=${encodeURIComponent(approval.approvalId)}`)
}
