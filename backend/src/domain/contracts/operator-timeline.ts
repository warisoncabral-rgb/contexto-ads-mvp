export interface OperatorTimelineItemV1 {
  auditEventId: string;
  category: 'context' | 'plan' | 'creative' | 'approval' | 'readiness' | 'executor' | 'safety';
  title: string;
  detail: string;
  result: 'success' | 'failure' | 'blocked' | 'partial' | 'info';
  actor: 'Usuário autenticado' | 'Sistema' | 'Contexto Ads' | 'Gerador' | 'Analista' | 'Adaptador Meta';
  evidenceRef: string;
  createdAt: string;
}

export interface OperatorCampaignTimelineV1 {
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  items: OperatorTimelineItemV1[];
  boundaries: {
    sanitizedOperationalHistory: true;
    immutableAuditSource: true;
    secretsExposed: false;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
