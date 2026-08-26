const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STEP_KEYS = new Set(['identity', 'asset_discovery', 'capability_validation', 'ad_account_read'])

export function parseMetaValidationInput(formData) {
  const tenantId = String(formData.get('tenantId') ?? '').trim()
  const connectionId = String(formData.get('connectionId') ?? '').trim()
  return UUID.test(tenantId) && UUID.test(connectionId)
    ? { ok: true, tenantId, connectionId }
    : { ok: false }
}

export function validReadOnlySmokeReport(report, expected) {
  if (!report || typeof report !== 'object'
    || !UUID.test(report.smokeTestId)
    || report.tenantId !== expected.tenantId
    || report.connectionId !== expected.connectionId
    || typeof report.passed !== 'boolean'
    || !Array.isArray(report.steps) || report.steps.length < 1 || report.steps.length > STEP_KEYS.size
    || !Array.isArray(report.blockers)
    || typeof report.generatedAt !== 'string'
    || Number.isNaN(Date.parse(report.generatedAt))) return false

  const seen = new Set()
  for (const step of report.steps) {
    if (!step || typeof step !== 'object' || !STEP_KEYS.has(step.key) || seen.has(step.key)
      || !['passed', 'blocked'].includes(step.status)
      || typeof step.meaning !== 'string' || step.meaning.length < 3
      || !Array.isArray(step.evidenceRefs)
      || step.evidenceRefs.some((value) => typeof value !== 'string')
      || (step.observedAt !== undefined
        && (typeof step.observedAt !== 'string' || Number.isNaN(Date.parse(step.observedAt))))) return false
    seen.add(step.key)
  }
  return report.blockers.every((value) => typeof value === 'string')
    && (!report.passed || (seen.size === STEP_KEYS.size && report.blockers.length === 0))
}
