const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLAN_CATEGORIES = new Set([
  'objective', 'budget', 'schedule', 'audience',
  'destination', 'creative_safety', 'execution_target',
])

export function parsePlanGenerationForm(formData) {
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  const campaignId = String(formData.get('campaignId') ?? '').trim()
  const contextVersionText = String(formData.get('contextVersion') ?? '').trim()
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(campaignId)) {
    return { ok: false, error: 'Cliente ou campanha inválidos.' }
  }
  if (!/^\d+$/.test(contextVersionText)) {
    return { ok: false, error: 'A versão do contexto é inválida.' }
  }
  const contextVersion = Number(contextVersionText)
  if (!Number.isSafeInteger(contextVersion) || contextVersion < 1) {
    return { ok: false, error: 'A versão do contexto é inválida.' }
  }
  return { ok: true, tenantId, campaignId, contextVersion }
}

function validDecision(decision) {
  return decision
    && typeof decision.decisionId === 'string'
    && PLAN_CATEGORIES.has(decision.category)
    && typeof decision.ruleId === 'string'
    && Array.isArray(decision.inputRefs)
    && decision.inputRefs.every((reference) => typeof reference === 'string')
    && decision.outcome && typeof decision.outcome === 'object'
    && typeof decision.rationale === 'string'
}

function validRisk(risk) {
  return risk
    && typeof risk.code === 'string'
    && ['low', 'medium', 'high'].includes(risk.severity)
    && typeof risk.meaning === 'string'
    && typeof risk.mitigation === 'string'
    && risk.blocksExecution === true
}

function validObject(object) {
  if (!object || !['campaign', 'ad_set', 'creative', 'ad'].includes(object.type)) return false
  if (typeof object.internalObjectId !== 'string' || !Array.isArray(object.dependsOn)) return false
  if (!object.logicalConfig || typeof object.logicalConfig !== 'object') return false
  return object.type === 'creative'
    ? object.logicalConfig.copyStatus === 'requires_generation_and_approval'
      && object.logicalConfig.claimsPolicy === 'source_only'
    : object.logicalConfig.lifecycleStatus === 'PAUSED'
}

export function validGeneratedPlan(plan, expected) {
  return plan
    && plan.tenantId === expected.tenantId
    && plan.campaignId === expected.campaignId
    && plan.campaignPackageVersion === expected.contextVersion
    && UUID_PATTERN.test(plan.executionPlanId)
    && plan.planVersion === '1.0'
    && plan.status === 'draft'
    && !Number.isNaN(Date.parse(plan.createdAt))
    && /^[0-9a-f]{64}$/.test(plan.planHash)
    && /^[0-9a-f]{64}$/.test(plan.idempotencyKey)
    && plan.autonomy?.level === 'A0'
    && plan.autonomy?.approvalRequired === true
    && Number.isSafeInteger(plan.financials?.configuredAmountMinor)
    && plan.financials.configuredAmountMinor > 0
    && Number.isSafeInteger(plan.financials?.maximumPlannedSpendMinor)
    && plan.financials.maximumPlannedSpendMinor > 0
    && /^[A-Z]{3}$/.test(plan.financials?.currency)
    && typeof plan.financials?.calculation === 'string'
    && Array.isArray(plan.decisions)
    && plan.decisions.length > 0
    && plan.decisions.every(validDecision)
    && Array.isArray(plan.risks)
    && plan.risks.length > 0
    && plan.risks.every(validRisk)
    && Array.isArray(plan.objectsToCreate)
    && plan.objectsToCreate.length === 4
    && plan.objectsToCreate.every(validObject)
    && plan.externalEffects?.writesAllowed === false
    && plan.externalEffects?.writesPerformed === false
}
