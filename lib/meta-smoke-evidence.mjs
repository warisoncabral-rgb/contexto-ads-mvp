const EXPECTED = ['identity', 'asset_discovery', 'capability_validation', 'ad_account_read']

export function deriveMetaSmokeEvidencePacket(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.steps)) return null
  const stepMap = new Map(report.steps.map((step) => [step.key, step]))
  if (stepMap.size !== EXPECTED.length || EXPECTED.some((key) => !stepMap.has(key))) return null
  const entries = EXPECTED.map((key) => {
    const step = stepMap.get(key)
    return {
      key,
      status: step.status,
      observedAt: step.observedAt ?? null,
      evidenceRefs: [...step.evidenceRefs],
      meaning: step.meaning,
    }
  })
  return {
    smokeTestId: report.smokeTestId,
    tenantId: report.tenantId,
    connectionId: report.connectionId,
    passed: report.passed,
    generatedAt: report.generatedAt,
    entries,
    blockers: [...report.blockers],
    evidenceReferenceCount: entries.reduce((total, entry) => total + entry.evidenceRefs.length, 0),
    boundaries: {
      packetDerivedFromPersistedSmokeReport: true,
      evidenceSufficiencyInferred: false,
      writePermissionInferred: false,
      externalWriteAuthorized: false,
    },
  }
}

export function formatMetaSmokeEvidencePacket(packet) {
  if (!packet) return ''
  const lines = [
    `Smoke test: ${packet.smokeTestId}`,
    `Tenant: ${packet.tenantId}`,
    `Connection: ${packet.connectionId}`,
    `Generated at: ${packet.generatedAt}`,
    `Result: ${packet.passed ? 'PASS' : 'BLOCKED'}`,
    '',
  ]
  for (const entry of packet.entries) {
    lines.push(`${entry.key}: ${entry.status}`)
    lines.push(`  observedAt: ${entry.observedAt ?? 'not_provided'}`)
    lines.push(`  evidenceRefs: ${entry.evidenceRefs.length ? entry.evidenceRefs.join(', ') : 'none'}`)
  }
  if (packet.blockers.length) lines.push('', `Blockers: ${packet.blockers.join(' | ')}`)
  lines.push('', 'Boundary: evidence references do not authorize Meta writes.')
  return lines.join('\n')
}
