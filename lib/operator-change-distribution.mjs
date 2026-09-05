const kinds = ['entered','worsened','improved','unchanged','resolved']

export function deriveOperatorChangeDistribution(queue) {
  const changes = queue.snapshots.flatMap((snapshot) => snapshot.comparison?.changes ?? [])
  return {
    totalChanges: changes.length,
    distribution: kinds.map((kind) => ({ kind, count: changes.filter((change) => change.kind === kind).length })),
    comparableTenantCount: queue.snapshots.filter((snapshot) => snapshot.comparison?.baselineAvailable).length,
    missingBaselineCount: queue.snapshots.filter((snapshot) => !snapshot.comparison?.baselineAvailable).length,
    boundaries: { trendInferred: false, performanceInferred: false, externalWritesPerformed: false },
  }
}
