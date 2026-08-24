const priorityRank = { critical: 0, high: 1, normal: 2 }

function summarize(items) {
  return {
    count: items.length,
    criticalCount: items.filter((item)=>item.priority==='critical').length,
    highCount: items.filter((item)=>item.priority==='high').length,
    tenantCount: new Set(items.map((item)=>item.tenantId)).size,
    items: [...items].sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority] || a.tenantDisplayName.localeCompare(b.tenantDisplayName) || a.blockerCode.localeCompare(b.blockerCode)).slice(0,5),
  }
}

export function deriveOperatorControlBoundaries(queue) {
  const operator = queue.items.filter((item)=>item.owner==='operator')
  const system = queue.items.filter((item)=>item.owner==='system')
  const meta = queue.items.filter((item)=>item.owner==='meta_environment')
  return {
    operator: summarize(operator),
    system: summarize(system),
    metaEnvironment: summarize(meta),
    totalCount: queue.items.length,
    externalEnvironmentCount: meta.length,
    boundaries: {
      responsibilityDerivedFromOwnerOnly: true,
      controllabilityInferred: false,
      authorizationInferred: false,
      externalWritesPerformed: false,
    },
  }
}
