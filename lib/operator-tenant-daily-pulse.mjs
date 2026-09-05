export function deriveOperatorTenantDailyPulse(queue) {
  const comparisonByTenant = new Map(queue.snapshots.map((snapshot) => [snapshot.tenantId, snapshot.comparison]))
  const tenantIds = [...new Set(queue.items.map((item) => item.tenantId))]
  const tenants = tenantIds.map((tenantId) => {
    const items = queue.items.filter((item) => item.tenantId === tenantId)
    const comparison = comparisonByTenant.get(tenantId)
    const changes = comparison?.changes ?? []
    const first = items[0]
    return {
      tenantId,
      tenantDisplayName: first?.tenantDisplayName ?? tenantId,
      primaryCampaignId: first?.campaignId ?? null,
      primaryExecutionPlanId: first?.executionPlanId ?? null,
      pendingCount: items.length,
      criticalCount: items.filter((item) => item.priority === 'critical').length,
      highCount: items.filter((item) => item.priority === 'high').length,
      operatorCount: items.filter((item) => item.owner === 'operator').length,
      systemCount: items.filter((item) => item.owner === 'system').length,
      metaEnvironmentCount: items.filter((item) => item.owner === 'meta_environment').length,
      enteredOrWorsenedCount: changes.filter((change) => change.kind === 'entered' || change.kind === 'worsened').length,
      improvedCount: changes.filter((change) => change.kind === 'improved').length,
      resolvedCount: changes.filter((change) => change.kind === 'resolved').length,
      baselineAvailable: comparison?.baselineAvailable === true,
      previousQueueDate: comparison?.previousQueueDate ?? null,
    }
  })
  tenants.sort((a, b) => b.criticalCount - a.criticalCount
    || b.enteredOrWorsenedCount - a.enteredOrWorsenedCount
    || b.pendingCount - a.pendingCount
    || a.tenantDisplayName.localeCompare(b.tenantDisplayName))
  return {
    tenants,
    summary: {
      tenantCount: tenants.length,
      tenantsWithCriticalCount: tenants.filter((tenant) => tenant.criticalCount > 0).length,
      tenantsWithNewRiskCount: tenants.filter((tenant) => tenant.enteredOrWorsenedCount > 0).length,
      tenantsWithoutBaselineCount: tenants.filter((tenant) => !tenant.baselineAvailable).length,
    },
    boundaries: {
      derivedFromValidatedQueueAndComparisons: true,
      riskScoreInvented: false,
      deadlinesFabricated: false,
      completionInferred: false,
      externalWritesPerformed: false,
    },
  }
}
