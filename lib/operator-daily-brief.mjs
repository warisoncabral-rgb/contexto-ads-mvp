const urgency = { critical: 0, high: 1, normal: 2 }
const changeUrgency = { worsened: 0, entered: 1, improved: 2, resolved: 3, unchanged: 4 }

function rankItem(item) {
  return [urgency[item.priority] ?? 99, item.owner === 'operator' ? 0 : 1,
    item.tenantDisplayName, item.campaignId, item.blockerCode]
}

function compareRank(a, b) {
  const ar = rankItem(a); const br = rankItem(b)
  for (let i = 0; i < ar.length; i += 1) {
    if (typeof ar[i] === 'number' && ar[i] !== br[i]) return ar[i] - br[i]
    if (String(ar[i]) !== String(br[i])) return String(ar[i]).localeCompare(String(br[i]))
  }
  return 0
}

export function deriveOperatorDailyBrief(queue, { limit = 5 } = {}) {
  const comparisons = queue.snapshots.map((snapshot) => snapshot.comparison)
  const changes = comparisons.flatMap((comparison) => comparison?.changes ?? [])
  const actionableChanges = changes.filter((change) => change.kind === 'worsened' || change.kind === 'entered')
    .sort((a, b) => (changeUrgency[a.kind] - changeUrgency[b.kind])
      || ((urgency[a.currentPriority] ?? 99) - (urgency[b.currentPriority] ?? 99))
      || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
      || a.blockerCode.localeCompare(b.blockerCode))
  const attention = [...queue.items].sort(compareRank).slice(0, limit)
  const resolved = changes.filter((change) => change.kind === 'resolved')
  const improved = changes.filter((change) => change.kind === 'improved')
  const baselineMissingCount = comparisons.filter((comparison) => !comparison?.baselineAvailable).length
  const headline = queue.summary.criticalCount > 0
    ? `${queue.summary.criticalCount} pendência(s) crítica(s) exigem atenção.`
    : actionableChanges.length > 0
      ? `${actionableChanges.length} mudança(s) nova(s) ou piora(s) exigem revisão.`
      : queue.summary.pendingItemCount > 0
        ? `${queue.summary.pendingItemCount} pendência(s) permanecem na fila, sem piora comprovada.`
        : 'Nenhuma pendência operacional atual foi comprovada.'
  return {
    headline,
    attention,
    actionableChanges: actionableChanges.slice(0, limit),
    resolvedCount: resolved.length,
    improvedCount: improved.length,
    baselineMissingCount,
    summary: {
      pendingCount: queue.summary.pendingItemCount,
      criticalCount: queue.summary.criticalCount,
      operatorCount: queue.summary.operatorCount,
      enteredOrWorsenedCount: actionableChanges.length,
      resolvedCount: resolved.length,
      improvedCount: improved.length,
    },
    boundaries: {
      derivedOnlyFromValidatedQueue: true,
      deadlinesFabricated: false,
      completionInferred: false,
      notificationsSent: false,
      externalWritesPerformed: false,
    },
  }
}
