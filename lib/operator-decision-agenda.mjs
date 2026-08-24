const priorityRank = { critical: 0, high: 1, normal: 2 }

function compareItems(a, b) {
  return (priorityRank[a.priority] - priorityRank[b.priority])
    || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
    || a.campaignId.localeCompare(b.campaignId)
    || a.blockerCode.localeCompare(b.blockerCode)
}

export function deriveOperatorDecisionAgenda(queue, { limitPerLane = 5 } = {}) {
  const operator = queue.items.filter((item) => item.owner === 'operator').sort(compareItems)
  const system = queue.items.filter((item) => item.owner === 'system').sort(compareItems)
  const metaEnvironment = queue.items.filter((item) => item.owner === 'meta_environment').sort(compareItems)
  const criticalOperator = operator.filter((item) => item.priority === 'critical')
  const highOperator = operator.filter((item) => item.priority === 'high')

  const headline = criticalOperator.length > 0
    ? `${criticalOperator.length} ação(ões) humana(s) crítica(s) estão na frente da agenda.`
    : operator.length > 0
      ? `${operator.length} ação(ões) dependem do operador.`
      : metaEnvironment.length > 0
        ? 'Nenhuma ação humana atual; há bloqueios no ambiente Meta.'
        : system.length > 0
          ? 'Nenhuma ação humana atual; há trabalho pendente do sistema.'
          : 'Nenhuma responsabilidade operacional pendente foi comprovada.'

  return {
    headline,
    lanes: {
      operator: operator.slice(0, limitPerLane),
      system: system.slice(0, limitPerLane),
      metaEnvironment: metaEnvironment.slice(0, limitPerLane),
    },
    summary: {
      operatorCount: operator.length,
      criticalOperatorCount: criticalOperator.length,
      highOperatorCount: highOperator.length,
      systemCount: system.length,
      metaEnvironmentCount: metaEnvironment.length,
    },
    boundaries: {
      responsibilityDerivedFromWorkItemOwner: true,
      ownerDecisionTypeInferred: false,
      deadlinesFabricated: false,
      completionInferred: false,
      notificationsSent: false,
      externalWritesPerformed: false,
    },
  }
}
