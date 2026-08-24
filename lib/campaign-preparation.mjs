import { loadOperatorAccess } from './operator-workspace.mjs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = new Set([
  'businessName', 'offer', 'objective', 'audience',
  'destination', 'geography', 'budget', 'durationDays',
])

function validFact(field, fact) {
  const base = fact
    && fact.source === 'user_input'
    && Array.isArray(fact.evidenceRefs)
    && fact.evidenceRefs.every((reference) => typeof reference === 'string')
    && !Number.isNaN(Date.parse(fact.recordedAt))
  if (!base) return false
  if (['businessName', 'offer', 'audience', 'geography'].includes(field)) {
    return typeof fact.value === 'string' && fact.value.length > 0
  }
  if (field === 'objective') {
    return ['awareness', 'traffic', 'engagement', 'leads', 'app_promotion', 'sales']
      .includes(fact.value)
  }
  if (field === 'destination') {
    return ['website', 'whatsapp', 'instagram', 'messenger', 'instant_form', 'app',
      'phone', 'physical_location', 'other'].includes(fact.value)
  }
  if (field === 'durationDays') {
    return Number.isSafeInteger(fact.value) && fact.value >= 1 && fact.value <= 365
  }
  return field === 'budget'
    && fact.value
    && ['daily', 'lifetime'].includes(fact.value.mode)
    && Number.isSafeInteger(fact.value.amountMinor)
    && fact.value.amountMinor > 0
    && /^[A-Z]{3}$/.test(fact.value.currency)
}

function validContext(context, tenantId) {
  return context
    && context.tenantId === tenantId
    && UUID_PATTERN.test(context.campaignId)
    && UUID_PATTERN.test(context.packageId)
    && Number.isSafeInteger(context.version)
    && context.version > 0
    && context.schemaVersion === '1.0'
    && ['needs_information', 'ready_for_generation'].includes(context.status)
    && context.facts && typeof context.facts === 'object'
    && Object.entries(context.facts).every(([field, fact]) => FIELDS.has(field) && validFact(field, fact))
    && Array.isArray(context.inferences)
    && context.inferences.length === 0
    && Array.isArray(context.validationIssues)
    && context.validationIssues.every((issue) => issue
      && issue.code === 'required_fact_missing'
      && FIELDS.has(issue.field)
      && issue.severity === 'blocker'
      && typeof issue.message === 'string'
      && typeof issue.nextAction === 'string')
    && /^[0-9a-f]{64}$/.test(context.contentHash)
    && !Number.isNaN(Date.parse(context.createdAt))
}

function validPayload(payload, tenantId) {
  return payload
    && payload.tenantId === tenantId
    && Array.isArray(payload.contexts)
    && payload.contexts.every((context) => validContext(context, tenantId))
    && payload.boundaries?.tenantAccessVerified === true
    && payload.boundaries?.latestContextPerCampaign === true
    && payload.boundaries?.publicationAuthorized === false
    && payload.boundaries?.externalWritesAllowed === false
    && payload.boundaries?.externalWritesPerformed === false
}

export async function loadCampaignPreparation({
  requestedTenantId = '',
  requestedCampaignId = '',
  apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL,
  operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN,
  fetchImpl = globalThis.fetch,
}) {
  const operatorAccess = await loadOperatorAccess({
    requestedTenantId,
    apiBaseUrl,
    operatorToken,
    fetchImpl,
  })
  if (operatorAccess.kind !== 'ready') return operatorAccess
  const { access, selectedTenant, base } = operatorAccess

  try {
    const response = await fetchImpl(
      `${base}/v1/operator/tenants/${encodeURIComponent(selectedTenant.tenantId)}/campaign-contexts`,
      {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(5000),
      },
    )
    if (response.status === 401 || response.status === 403) return { kind: 'access_denied' }
    if (!response.ok) return { kind: 'unavailable' }
    const payload = await response.json()
    if (!validPayload(payload, selectedTenant.tenantId)) return { kind: 'unavailable' }
    const selectedContext = requestedCampaignId
      ? payload.contexts.find((context) => context.campaignId === requestedCampaignId)
      : null
    if (requestedCampaignId && !selectedContext) {
      return { kind: 'invalid_selection', access, selectedTenant }
    }
    return {
      kind: 'ready',
      access,
      selectedTenant,
      contexts: payload.contexts,
      selectedContext,
      canEdit: selectedTenant.permissions.includes('manage_campaign_preparation'),
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

export function parseCampaignForm(formData) {
  const text = (name) => String(formData.get(name) ?? '').trim()
  const values = {
    tenantId: text('tenantId'),
    campaignId: text('campaignId'),
    businessName: text('businessName'),
    offer: text('offer'),
    objective: text('objective'),
    audience: text('audience'),
    destination: text('destination'),
    geography: text('geography'),
    budgetMode: text('budgetMode'),
    budgetAmount: text('budgetAmount'),
    durationDays: text('durationDays'),
  }
  if (!UUID_PATTERN.test(values.tenantId)) return { ok: false, error: 'Cliente inválido.', values }
  if (values.campaignId && !UUID_PATTERN.test(values.campaignId)) {
    return { ok: false, error: 'Campanha inválida.', values }
  }
  const facts = {}
  for (const field of ['businessName', 'offer', 'objective', 'audience', 'destination', 'geography']) {
    if (values[field]) facts[field] = values[field]
  }
  if (values.durationDays) {
    if (!/^\d{1,3}$/.test(values.durationDays)) {
      return { ok: false, error: 'A duração deve ser informada em dias inteiros.', values }
    }
    const durationDays = Number(values.durationDays)
    if (durationDays < 1 || durationDays > 365) {
      return { ok: false, error: 'A duração deve ficar entre 1 e 365 dias.', values }
    }
    facts.durationDays = durationDays
  }
  const budgetParts = [values.budgetMode, values.budgetAmount]
  if (budgetParts.some(Boolean) && !budgetParts.every(Boolean)) {
    return { ok: false, error: 'Informe o tipo e o valor do orçamento juntos.', values }
  }
  if (budgetParts.every(Boolean)) {
    if (!['daily', 'lifetime'].includes(values.budgetMode)) {
      return { ok: false, error: 'Selecione um tipo de orçamento válido.', values }
    }
    const normalized = values.budgetAmount.replace(',', '.')
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) {
      return { ok: false, error: 'Informe um orçamento válido, com até duas casas decimais.', values }
    }
    const [whole, fraction = ''] = normalized.split('.')
    facts.budget = {
      mode: values.budgetMode,
      amountMinor: Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
      currency: 'BRL',
    }
  }
  return { ok: true, values, facts }
}
