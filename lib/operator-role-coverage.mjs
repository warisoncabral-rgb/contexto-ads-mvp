const roles = ['owner', 'operator', 'viewer']

export function deriveOperatorRoleCoverage(queue) {
  const coverage = roles.map((role) => {
    const items = queue.items.filter((item) => item.role === role)
    return {
      role,
      workItemCount: items.length,
      tenantCount: new Set(items.map((item) => item.tenantId)).size,
      criticalCount: items.filter((item) => item.priority === 'critical').length,
      operatorOwnedCount: items.filter((item) => item.owner === 'operator').length,
      systemOwnedCount: items.filter((item) => item.owner === 'system').length,
      metaEnvironmentOwnedCount: items.filter((item) => item.owner === 'meta_environment').length,
    }
  })
  return {
    coverage,
    boundaries: { roleReadFromMembershipScopedQueue: true, permissionsInferredFromRole: false,
      authorizationExpanded: false, externalWritesPerformed: false },
  }
}
