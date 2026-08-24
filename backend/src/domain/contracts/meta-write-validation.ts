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
  mode: 'controlled_paused_creation';
  status: 'prepared_external_validation_required';
  preparedBy: string;
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
    status: 'required_not_collected';
    source: 'real_meta_environment';
    evidenceRefs: [];
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
    protocolIsExecutionCommand: false;
    executionRecordCreated: false;
    externalAttemptStarted: false;
    realMetaWriteValidated: false;
    writeAdapterEnabled: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  correlationId: string;
  preparedAt: string;
}
