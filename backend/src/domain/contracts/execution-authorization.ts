export interface ExecutionAuthorizationV1 {
  executionAuthorizationId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  executionManifestId: string;
  planHash: string;
  manifestHash: string;
  actionType: 'authorize_controlled_paused_creation';
  riskLevel: 'high';
  scope: string[];
  requestedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  decisionReason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'invalidated';
  expiresAt: string;
  correlationId: string;
  boundaries: {
    effectiveExecutionPermission: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPreflightCheckV1 {
  key:
    | 'manifest_current'
    | 'specific_execution_authorization'
    | 'tenant_kill_switch'
    | 'campaign_kill_switch'
    | 'meta_geography_resolved'
    | 'real_meta_write_validation'
    | 'write_adapter_enabled';
  status: 'passed' | 'blocked';
  evidenceRefs: string[];
  meaning: string;
}

export interface ExecutionPreflightV1 {
  executionPreflightId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  executionManifestId: string;
  executionAuthorizationId: string;
  planHash: string;
  manifestHash: string;
  preflightHash: string;
  status: 'blocked_before_attempt';
  checks: ExecutionPreflightCheckV1[];
  blockers: ExecutionPreflightCheckV1['key'][];
  nextAction: string;
  boundaries: {
    executionRecordCreated: false;
    externalAttemptStarted: false;
    campaignPublished: false;
    campaignActive: false;
    campaignDelivering: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
