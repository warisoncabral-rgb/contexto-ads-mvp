const priorityRank = { critical: 0, high: 1, normal: 2 }

function compareItems(a, b) {
  return (priorityRank[a.priority] - priorityRank[b.priority])
    || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
    || a.campaignId.localeCompare(b.campaignId)
    || a.blockerCode.localeCompare(b.blockerCode)
}

export function deriveOperatorHumanActionEvidence(queue, { limit = 5 } = {}) {
  const operatorItems = queue.items.filter((item) => item.owner === 'operator').sort(compareItems)
  const withEvidence = operatorItems.filter((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0)
  const withoutEvidence = operatorItems.filter((item) => !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0)
  const outsideHumanControl = queue.items.filter((item) => item.owner !== 'operator').sort(compareItems)

  const headline = withoutEvidence.length > 0
    ? `${withoutEvidence.length} ação(ões) do operador não possuem evidência vinculada no contrato atual.`
    : operatorItems.length > 0
      ? `${operatorItems.length} ação(ões) do operador possuem ao menos uma referência de evidência.`
      : outsideHumanControl.length > 0
        ? 'Nenhuma ação do operador está pendente; os itens atuais pertencem ao sistema ou ambiente Meta.'
        : 'Nenhuma ação humana pendente foi comprovada.'

  return {
    headline,
    operator: {
      withEvidence: withEvidence.slice(0, limit),
      withoutEvidence: withoutEvidence.slice(0, limit),
      totalCount: operatorItems.length,
      withEvidenceCount: withEvidence.length,
      withoutEvidenceCount: withoutEvidence.length,
    },
    outsideHumanControl: outsideHumanControl.slice(0, limit),
    outsideHumanControlCount: outsideHumanControl.length,
    boundaries: {
      evidencePresenceDerivedFromRefsOnly: true,
      evidenceSufficiencyInferred: false,
      executionReadinessInferred: false,
      authorizationInferred: false,
      deadlinesFabricated: false,
      completionInferred: false,
      externalWritesPerformed: false,
    },
  }
}
