const sourceOrder = ['campaign_plans', 'operational_readiness', 'execution_lifecycle', 'delivery_metrics']

export function deriveOperatorSourceCoverage(queue) {
  const tenants = queue.snapshots.map((snapshot) => ({
    tenantId: snapshot.tenantId,
    queueDate: snapshot.queueDate,
    decisions: sourceOrder.map((source) => snapshot.sourceDecisions.find((decision) => decision.source === source)),
  }))
  const sources = sourceOrder.map((source) => {
    const decisions = tenants.map((tenant) => tenant.decisions.find((decision) => decision.source === source))
    return {
      source,
      includedCount: decisions.filter((decision) => decision.status === 'included').length,
      deferredCount: decisions.filter((decision) => decision.status === 'deferred').length,
      ignoredCount: decisions.filter((decision) => decision.status === 'ignored').length,
      tenantCount: decisions.length,
      uniformStatus: new Set(decisions.map((decision) => decision.status)).size === 1 ? decisions[0]?.status ?? null : null,
    }
  })
  return {
    tenants,
    sources,
    summary: {
      tenantCount: tenants.length,
      tenantsWithDeferredCount: tenants.filter((tenant) => tenant.decisions.some((decision) => decision.status === 'deferred')).length,
      tenantsWithIgnoredCount: tenants.filter((tenant) => tenant.decisions.some((decision) => decision.status === 'ignored')).length,
      mixedSourceStatusCount: sources.filter((source) => source.uniformStatus === null).length,
    },
    boundaries: {
      derivedFromEverySnapshot: true,
      firstTenantUsedAsGlobalProxy: false,
      sourceAvailabilityInferred: false,
      externalWritesPerformed: false,
    },
  }
}
