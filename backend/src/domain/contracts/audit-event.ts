export interface AuditEvent {
  auditEventId: string;
  tenantId: string;
  correlationId: string;
  actorType: 'user' | 'system' | 'contexto_ads' | 'generator' | 'analyst' | 'meta_adapter';
  actorId?: string;
  eventType: string;
  objectType?: string;
  objectId?: string;
  previousState?: unknown;
  newState?: unknown;
  result: 'success' | 'failure' | 'blocked' | 'partial' | 'info';
  normalizedError?: string;
  createdAt: string;
}
