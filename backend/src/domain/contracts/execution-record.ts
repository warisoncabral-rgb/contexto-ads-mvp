import { ExecutionRecordStatus } from '../enums/states';

export interface ExecutionStepRecord {
  stepId: string;
  stepType: string;
  idempotencyKey: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'uncertain';
  attempt: number;
  externalObjectId?: string;
  normalizedError?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionRecordV1 {
  executionRecordId: string;
  executionPlanId: string;
  tenantId: string;
  correlationId: string;
  approvedPlanHash: string;
  status: ExecutionRecordStatus;
  steps: ExecutionStepRecord[];
  externalObjects: Record<string, { externalId: string; observedStatus?: string }>;
  differences: Array<{ path: string; planned: unknown; observed: unknown; reason?: string }>;
  createdAt: string;
  updatedAt: string;
}
