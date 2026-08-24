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

export interface ReadOnlySmokeTestStep {
  key: 'identity' | 'asset_discovery' | 'capability_validation' | 'ad_account_read';
  status: 'passed' | 'blocked';
  meaning: string;
  evidenceRefs: string[];
  observedAt?: string;
}

export interface ReadOnlySmokeTestReport {
  smokeTestId: string;
  tenantId: string;
  connectionId: string;
  passed: boolean;
  steps: ReadOnlySmokeTestStep[];
  blockers: string[];
  generatedAt: string;
}
