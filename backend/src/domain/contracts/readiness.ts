import { ReadinessCheckStatus } from '../enums/states';

export interface ReadinessCheck {
  key: string;
  status: ReadinessCheckStatus;
  meaning: string;
  nextAction?: string;
  evidenceRefs: string[];
  source: 'meta_api' | 'campaign_package' | 'user_confirmation' | 'system';
}

export interface ReadinessSnapshot {
  snapshotId: string;
  tenantId: string;
  connectionId: string;
  correlationId: string;
  checks: ReadinessCheck[];
  blockers: string[];
  generatedAt: string;
}
