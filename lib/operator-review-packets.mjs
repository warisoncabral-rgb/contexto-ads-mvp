const rank = { critical: 0, high: 1, normal: 2 }

function compareItems(a, b) {
  return (rank[a.priority] - rank[b.priority])
    || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
    || a.campaignId.localeCompare(b.campaignId)
    || a.blockerCode.localeCompare(b.blockerCode)
}

export function deriveOperatorReviewPackets(queue, { limit = 5 } = {}) {
  const comparisonsByTenant = new Map(queue.snapshots.map((snapshot) => [snapshot.tenantId, snapshot.comparison]))
  const packets = queue.items.filter((item) => item.owner === 'operator').sort(compareItems).map((item) => {
    const comparison = comparisonsByTenant.get(item.tenantId)
    const change = comparison?.changes?.find((candidate) => candidate.workItemId === item.workItemId)
    return {
      workItemId: item.workItemId,
      tenantId: item.tenantId,
      tenantDisplayName: item.tenantDisplayName,
      campaignId: item.campaignId,
      executionPlanId: item.executionPlanId,
      blockerCode: item.blockerCode,
      priority: item.priority,
      meaning: item.meaning,
      nextAction: item.nextAction,
      evidenceRefs: [...item.evidenceRefs],
      evidenceRefCount: item.evidenceRefs.length,
      baselineAvailable: comparison?.baselineAvailable === true,
      changeKind: change?.kind ?? null,
      previousPriority: change?.previousPriority ?? null,
      currentPriority: change?.currentPriority ?? item.priority,
      previousQueueDate: change?.previousQueueDate ?? comparison?.previousQueueDate ?? null,
      currentQueueDate: change?.currentQueueDate ?? queue.snapshots.find((snapshot) => snapshot.tenantId === item.tenantId)?.queueDate ?? null,
    }
  })
  return {
    packets: packets.slice(0, limit),
    totalCount: packets.length,
    withBaselineCount: packets.filter((packet) => packet.baselineAvailable).length,
    withChangeContextCount: packets.filter((packet) => packet.changeKind !== null).length,
    boundaries: {
      operatorItemsOnly: true,
      evidenceSufficiencyInferred: false,
      executionReadinessInferred: false,
      authorizationInferred: false,
      completionInferred: false,
      externalWritesPerformed: false,
    },
  }
}
