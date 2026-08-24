export function deriveOperatorCommandCenter(queue) {
  const comparisons = queue.snapshots.map((snapshot)=>snapshot.comparison)
  const changes = comparisons.flatMap((comparison)=>comparison.changes)
  return {
    pendingCount: queue.items.length,
    criticalCount: queue.items.filter((item)=>item.priority==='critical').length,
    operatorCount: queue.items.filter((item)=>item.owner==='operator').length,
    metaEnvironmentCount: queue.items.filter((item)=>item.owner==='meta_environment').length,
    tenantCount: new Set(queue.items.map((item)=>item.tenantId)).size,
    enteredOrWorsenedCount: changes.filter((change)=>change.kind==='entered'||change.kind==='worsened').length,
    resolvedCount: changes.filter((change)=>change.kind==='resolved').length,
    baselineMissingCount: comparisons.filter((comparison)=>!comparison.baselineAvailable).length,
    navigation: [
      ['/work-queue','Fila diária'],['/work-queue/tenants','Pulso por cliente'],['/work-queue/campaigns','Pulso por campanha'],
      ['/work-queue/sources','Cobertura de fontes'],['/work-queue/evidence','Referências de evidência'],
      ['/work-queue/recency','Recência dos dados'],['/work-queue/gaps','Lacunas de observabilidade'],
      ['/work-queue/blockers','Concentração de bloqueios'],['/work-queue/responsibility','Responsabilidades'],
    ],
    boundaries: { newOperationalStateCreated:false, syntheticMetricInvented:false, externalWritesPerformed:false },
  }
}
