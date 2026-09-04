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

export interface MetaPreflightDiagnosticV1 {
  status: 'passed' | 'blocked';
  observedAt: string;
  connection: {
    status: 'passed' | 'blocked';
    connectionId?: string;
    connectionStatus?: string;
    oauthSubjectId?: string;
    normalizedError?: string;
    reason?: string;
  };
  adAccount: {
    status: 'passed' | 'blocked';
    configuredId?: string;
    recognizedId?: string;
    name?: string;
    accountStatus?: string | number;
    currency?: string;
    timezoneName?: string;
    normalizedError?: string;
    reason?: string;
  };
  facebookPage: {
    status: 'passed' | 'blocked';
    selectedId?: string;
    selectedDisplayName?: string;
    discovered: boolean;
    reason?: string;
  };
  whatsapp: {
    status: 'passed' | 'blocked';
    selectedId?: string;
    selectedDisplayName?: string;
    recognizedNumber?: string;
    discovered: boolean;
    reason?: string;
  };
  relationships: {
    status: 'passed' | 'blocked';
    selectedPageCount: number;
    selectedWhatsappCount: number;
    selectedAdAccountCount: number;
    reason?: string;
  };
  permissions: {
    status: 'passed' | 'blocked';
    required: string[];
    granted: string[];
    missing: string[];
    capabilities: Array<{
      capability: string;
      available: boolean;
      assetScope?: string;
      reason?: string;
    }>;
    normalizedError?: string;
    reason?: string;
  };
  failureCode?:
    | 'meta_connection_not_ready'
    | 'meta_connection_validation_failed'
    | 'ad_account_missing_or_invalid'
    | 'ad_account_not_recognized'
    | 'facebook_page_missing_or_ambiguous'
    | 'facebook_page_not_discovered'
    | 'whatsapp_missing_or_ambiguous'
    | 'whatsapp_not_discovered'
    | 'asset_relationship_incomplete'
    | 'meta_permissions_missing'
    | 'meta_read_diagnostic_unavailable';
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
  metaDiagnostic?: MetaPreflightDiagnosticV1;
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
