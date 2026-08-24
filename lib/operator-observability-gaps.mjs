export function deriveOperatorObservabilityGaps(queue) {
  const gaps = []
  for (const snapshot of queue.snapshots) {
    if (!snapshot.comparison.baselineAvailable) gaps.push({ tenantId: snapshot.tenantId, kind: 'missing_baseline', source: null, reason: 'Não existe checkpoint anterior para comparação.' })
    for (const decision of snapshot.sourceDecisions) {
      if (decision.status === 'deferred' || decision.status === 'ignored') gaps.push({ tenantId: snapshot.tenantId, kind: decision.status === 'deferred' ? 'source_deferred' : 'source_ignored', source: decision.source, reason: decision.reason })
    }
  }
  return {
    gaps,
    summary: {
      totalGapCount: gaps.length,
      tenantCount: new Set(gaps.map((gap) => gap.tenantId)).size,
      missingBaselineCount: gaps.filter((gap) => gap.kind === 'missing_baseline').length,
      deferredSourceCount: gaps.filter((gap) => gap.kind === 'source_deferred').length,
      ignoredSourceCount: gaps.filter((gap) => gap.kind === 'source_ignored').length,
    },
    boundaries: {
      derivedOnlyFromExplicitMissingCoverage: true,
      businessRiskInferred: false,
      missingDataSimulated: false,
      externalWritesPerformed: false,
    },
  }
}
