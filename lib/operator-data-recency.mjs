function earliest(values) { return values.length ? [...values].sort()[0] : null }
function latest(values) { return values.length ? [...values].sort().at(-1) : null }

export function deriveOperatorDataRecency(queue) {
  const observed = queue.items.map((item) => item.observedAt)
  const snapshots = queue.snapshots.map((snapshot) => snapshot.generatedAt)
  return {
    queueGeneratedAt: queue.generatedAt,
    oldestItemObservedAt: earliest(observed),
    newestItemObservedAt: latest(observed),
    oldestSnapshotGeneratedAt: earliest(snapshots),
    newestSnapshotGeneratedAt: latest(snapshots),
    tenants: queue.snapshots.map((snapshot) => ({ tenantId: snapshot.tenantId, queueDate: snapshot.queueDate, snapshotGeneratedAt: snapshot.generatedAt, itemObservedAt: queue.items.filter((item) => item.tenantId === snapshot.tenantId).map((item) => item.observedAt).sort() })),
    boundaries: {
      timestampsReportedAsPersisted: true,
      staleThresholdInvented: false,
      freshnessClaimInferred: false,
      externalWritesPerformed: false,
    },
  }
}
