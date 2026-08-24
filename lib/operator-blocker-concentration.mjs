const priorityRank = { critical: 0, high: 1, normal: 2 }

export function deriveOperatorBlockerConcentration(queue) {
  const groups = new Map()
  for (const item of queue.items) {
    const key = item.blockerCode
    const group = groups.get(key) ?? { blockerCode: key, itemCount: 0, tenantIds: new Set(), owners: new Set(), priorities: new Set(), highestPriority: 'normal' }
    group.itemCount += 1
    group.tenantIds.add(item.tenantId)
    group.owners.add(item.owner)
    group.priorities.add(item.priority)
    if (priorityRank[item.priority] < priorityRank[group.highestPriority]) group.highestPriority = item.priority
    groups.set(key, group)
  }
  const blockers = [...groups.values()].map((group) => ({
    blockerCode: group.blockerCode,
    itemCount: group.itemCount,
    tenantCount: group.tenantIds.size,
    owners: [...group.owners].sort(),
    priorities: [...group.priorities].sort((a,b)=>priorityRank[a]-priorityRank[b]),
    highestPriority: group.highestPriority,
  })).sort((a,b)=>b.tenantCount-a.tenantCount || b.itemCount-a.itemCount || priorityRank[a.highestPriority]-priorityRank[b.highestPriority] || a.blockerCode.localeCompare(b.blockerCode))
  return {
    blockers,
    repeatedAcrossTenantsCount: blockers.filter((item)=>item.tenantCount>1).length,
    boundaries: { causeInferred: false, riskScoreInvented: false, externalWritesPerformed: false },
  }
}
