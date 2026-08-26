import { SimulatedOperation } from './execution-simulation';

export type MetaWriteValidationEvidenceKey =
  | 'meta_app_identity'
  | 'graph_api_version'
  | 'oauth_subject'
  | 'ad_account_binding'
  | 'ads_management_permission'
  | 'request_fingerprints'
  | 'sanitized_meta_responses'
  | 'external_object_ids'
  | 'observed_paused_state'
  | 'reconciliation_completed'
  | 'zero_delivery_confirmed';

export interface MetaWriteValidationProtocolV1 {
  metaWriteValidationProtocolId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  executionManifestId: string;
  planHash: string;
  manifestHash: string;
  protocolHash: string;
  version: 1;
  attempt: number;
  replacesProtocolId?: string;
  mode: 'controlled_paused_creation';
  status:
    | 'prepared_external_validation_required'
    | 'external_validation_running'
    | 'external_validation_failed'
    | 'external_validation_succeeded';
  preparedBy: string;
  reconciledOperations?: Array<{
    operationKey: string;
    objectType: SimulatedOperation['objectType'];
    externalObjectId: string;
    observedStatus: string;
  }>;
  operations: Array<{
    order: number;
    operationKey: string;
    objectType: SimulatedOperation['objectType'];
    action: SimulatedOperation['action'];
    requestFingerprint: string;
    intendedLifecycleStatus: 'PAUSED';
  }>;
  limits: {
    exactOperationCount: number;
    allowedActions: SimulatedOperation['action'][];
    requiredLifecycleStatus: 'PAUSED';
    activationAllowed: false;
    deliveryAllowed: false;
    budgetIncreaseAllowed: false;
    automaticRetryAllowed: false;
    concurrentAttemptAllowed: false;
  };
  requiredEvidence: Array<{
    key: MetaWriteValidationEvidenceKey;
    status: 'required_not_collected' | 'collected' | 'failed';
    source: 'real_meta_environment';
    evidenceRefs: string[];
  }>;
  failurePolicy: {
    ambiguousOutcome: 'stop_and_reconcile_before_retry';
    partialFailure: 'stop_dependents_and_preserve_evidence';
    unexpectedActiveState: 'engage_kill_switch_and_stop';
    evidenceMissing: 'validation_fails_closed';
  };
  successCriteria: {
    allOperationsCreatedExactlyOnce: true;
    allObjectsObservedPaused: true;
    noDeliveryObserved: true;
    reconciliationCompleted: true;
    sanitizedEvidenceComplete: true;
  };
  boundaries: {
    protocolIsExecutionCommand: boolean;
    executionRecordCreated: boolean;
    externalAttemptStarted: boolean;
    realMetaWriteValidated: boolean;
    writeAdapterEnabled: boolean;
    externalWritesAllowed: boolean;
    externalWritesPerformed: boolean;
  };
  execution?: {
    executionAuthorizationId: string;
    startedAt: string;
    completedAt?: string;
    operations: Array<{
      operationKey: string;
      objectType: SimulatedOperation['objectType'];
      status: 'pending' | 'succeeded' | 'failed' | 'uncertain';
      externalObjectId?: string;
      observedStatus?: string;
      sanitizedResponseRef?: string;
      normalizedError?: string;
      diagnosticCode?: string;
    }>;
  };
  correlationId: string;
  preparedAt: string;
}
