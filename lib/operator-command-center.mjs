export function deriveOperatorCommandCenter(queue) {
  const comparisons = queue.snapshots.map((snapshot)=>snapshot.comparison)
  const changes = comparisons.flatMap((comparison)=>comparison.changes)
  return {
    pendingCount: queue.items.length,
    criticalCount: queue.items.filter((item)=>item.priority==='critical').length,
    operatorCount: queue.items.filter((item)=>item.owner==='operator').length,
    metaEnvironmentCount: queue.items.filter((item)=>item.owner==='meta_environment').length,
    tenantCount: new Set(queue.snapshots.map((snapshot)=>snapshot.tenantId)).size,
    enteredOrWorsenedCount: changes.filter((change)=>change.kind==='entered'||change.kind==='worsened').length,
    resolvedCount: changes.filter((change)=>change.kind==='resolved').length,
    baselineMissingCount: comparisons.filter((comparison)=>!comparison.baselineAvailable).length,
    navigation: [
      ['/work-queue','Fila diária'],['/work-queue/tenants','Pulso por cliente'],['/work-queue/campaigns','Pulso por campanha'],
      ['/work-queue/coverage','Cobertura de clientes'],['/work-queue/current-history','Atual × histórico'],
      ['/work-queue/changes','Distribuição de mudanças'],['/work-queue/priorities','Distribuição de prioridades'],
      ['/work-queue/sources','Cobertura de fontes'],['/work-queue/source-matrix','Matriz de fontes'],
      ['/work-queue/evidence','Referências de evidência'],['/work-queue/evidence-density','Densidade de referências'],
      ['/work-queue/recency','Recência dos dados'],['/work-queue/snapshots','Auditoria de snapshots'],
      ['/work-queue/gaps','Lacunas de observabilidade'],['/work-queue/blockers','Concentração de bloqueios'],
      ['/work-queue/responsibility','Responsabilidades'],['/work-queue/owner-priority','Responsabilidade × prioridade'],
      ['/work-queue/access','Papéis de membership'],['/work-queue/boundaries','Ledger de limites'],
    ],
    boundaries: { newOperationalStateCreated:false, syntheticMetricInvented:false, externalWritesPerformed:false },
  }
}
