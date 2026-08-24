function namespaceOf(ref) {
  const separator = ref.indexOf(':')
  return separator > 0 ? ref.slice(0, separator) : null
}

export function deriveOperatorEvidenceReferenceMap(queue) {
  const references = queue.items.flatMap((item) => item.evidenceRefs.map((ref) => ({ ref, item })))
  const grouped = new Map()
  for (const entry of references) {
    const namespace = namespaceOf(entry.ref) ?? 'unscoped'
    const current = grouped.get(namespace) ?? { namespace, referenceCount: 0, workItemIds: new Set(), tenantIds: new Set(), owners: new Set() }
    current.referenceCount += 1
    current.workItemIds.add(entry.item.workItemId)
    current.tenantIds.add(entry.item.tenantId)
    current.owners.add(entry.item.owner)
    grouped.set(namespace, current)
  }
  const namespaces = [...grouped.values()].map((entry) => ({
    namespace: entry.namespace,
    referenceCount: entry.referenceCount,
    workItemCount: entry.workItemIds.size,
    tenantCount: entry.tenantIds.size,
    owners: [...entry.owners].sort(),
  })).sort((a, b) => b.referenceCount - a.referenceCount || a.namespace.localeCompare(b.namespace))
  return {
    namespaces,
    summary: {
      referenceCount: references.length,
      namespaceCount: namespaces.length,
      unscopedReferenceCount: namespaces.find((entry) => entry.namespace === 'unscoped')?.referenceCount ?? 0,
    },
    boundaries: { namespaceIsSyntacticOnly: true, evidenceValidityInferred: false,
      evidenceSufficiencyInferred: false, externalWritesPerformed: false },
  }
}
