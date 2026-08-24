export function deriveOperatorCampaignPulse(queue) {
  const changes = queue.snapshots.flatMap((snapshot) => snapshot.comparison.changes)
  const byKey = new Map()
  for (const item of queue.items) {
    const key = `${item.tenantId}:${item.campaignId}`
    const entry = byKey.get(key) ?? { tenantId: item.tenantId, tenantDisplayName: item.tenantDisplayName,
      campaignId: item.campaignId, executionPlanIds: new Set(), items: [] }
    entry.executionPlanIds.add(item.executionPlanId)
    entry.items.push(item)
    byKey.set(key, entry)
  }
  const campaigns = [...byKey.values()].map((entry) => {
    const campaignChanges = changes.filter((change) => change.tenantId === entry.tenantId && change.campaignId === entry.campaignId)
    return {
      tenantId: entry.tenantId,
      tenantDisplayName: entry.tenantDisplayName,
      campaignId: entry.campaignId,
      executionPlanIds: [...entry.executionPlanIds].sort(),
      pendingCount: entry.items.length,
      criticalCount: entry.items.filter((item) => item.priority === 'critical').length,
      highCount: entry.items.filter((item) => item.priority === 'high').length,
      operatorCount: entry.items.filter((item) => item.owner === 'operator').length,
      systemCount: entry.items.filter((item) => item.owner === 'system').length,
      metaEnvironmentCount: entry.items.filter((item) => item.owner === 'meta_environment').length,
      enteredOrWorsenedCount: campaignChanges.filter((change) => change.kind === 'entered' || change.kind === 'worsened').length,
      improvedCount: campaignChanges.filter((change) => change.kind === 'improved').length,
      resolvedCount: campaignChanges.filter((change) => change.kind === 'resolved').length,
    }
  })
  campaigns.sort((a, b) => b.criticalCount - a.criticalCount
    || b.enteredOrWorsenedCount - a.enteredOrWorsenedCount
    || b.pendingCount - a.pendingCount
    || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
    || a.campaignId.localeCompare(b.campaignId))
  return {
    campaigns,
    summary: {
      campaignCount: campaigns.length,
      campaignsWithCriticalCount: campaigns.filter((campaign) => campaign.criticalCount > 0).length,
      campaignsWithEnteredOrWorsenedCount: campaigns.filter((campaign) => campaign.enteredOrWorsenedCount > 0).length,
    },
    boundaries: { derivedFromValidatedQueue: true, performanceInferred: false, riskScoreInvented: false,
      completionInferred: false, externalWritesPerformed: false },
  }
}
