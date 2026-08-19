export type MetaConnectionStatus =
  | 'disconnected'
  | 'authorization_pending'
  | 'connected'
  | 'validating'
  | 'ready'
  | 'permission_incomplete'
  | 'restricted'
  | 'reauth_required'
  | 'error';

export type CapabilityStatus =
  | 'available'
  | 'unavailable'
  | 'restricted'
  | 'permission_missing'
  | 'asset_missing'
  | 'reauth_required'
  | 'unsupported'
  | 'unknown';

export type ReadinessCheckStatus = 'passed' | 'pending' | 'blocked' | 'not_applicable';

export type ExecutionPlanStatus =
  | 'draft'
  | 'pending'
  | 'blocked'
  | 'ready_for_approval'
  | 'approved'
  | 'executing';

export type ExecutionRecordStatus =
  | 'queued'
  | 'executing'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reconciliation_required';
