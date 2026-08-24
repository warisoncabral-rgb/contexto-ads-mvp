import { SimulatedOperation } from './execution-simulation';

export interface ExecutionManifestOperationV1 {
  order: number;
  operationKey: string;
  idempotencyKey: string;
  requestFingerprint: string;
  internalObjectId: string;
  objectType: SimulatedOperation['objectType'];
  action: SimulatedOperation['action'];
  dependsOnOperationKeys: string[];
  intendedLifecycleStatus: 'PAUSED';
  effectState: 'not_started';
  executionAllowed: false;
  preconditions: Array<{
    key:
      | 'plan_hash_current'
      | 'execution_approval_fresh'
      | 'meta_target_current'
      | 'write_capabilities_current'
      | 'creative_hash_current'
      | 'write_adapter_enabled'
      | 'kill_switch_open';
    timing: 'revalidate_immediately_before_write';
  }>;
  recovery: {
    ambiguousOutcome: 'block_and_reconcile_before_retry';
    partialFailure: 'stop_dependents_and_preserve_evidence';
    compensation: 'manual_policy_required_before_any_external_change';
  };
}

export interface ExecutionManifestV1 {
  executionManifestId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  readinessDecisionId: string;
  simulationId: string;
  planHash: string;
  manifestHash: string;
  status: 'prepared_gate_closed';
  operations: ExecutionManifestOperationV1[];
  executionGate: {
    status: 'closed';
    reason: 'write_path_not_validated_or_enabled';
    requirements: Array<{
      key:
        | 'fresh_operational_readiness'
        | 'specific_execution_approval'
        | 'real_meta_write_validation'
        | 'write_adapter_enabled'
        | 'kill_switch_validated';
      status: 'satisfied' | 'missing' | 'requires_execution_time_validation';
      evidenceRefs: string[];
    }>;
  };
  reconciliationPolicy: {
    sourceOfTruth: 'meta_observed_state_with_internal_execution_record';
    unknownOutcome: 'stop_and_reconcile';
    retry: 'forbidden_until_previous_outcome_is_known';
    successEvidenceRequired: Array<'external_object_id' | 'meta_response' | 'observed_state'>;
    automaticCorrection: 'only_when_safe_and_explicitly_authorized';
  };
  boundaries: {
    executable: false;
    campaignPublished: false;
    campaignActive: false;
    campaignDelivering: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
