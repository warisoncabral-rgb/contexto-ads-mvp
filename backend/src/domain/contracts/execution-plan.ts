import { ExecutionPlanStatus } from '../enums/states';
import { MetaCapabilityType } from './capability';
import { ReadinessCheck } from './readiness';

export interface ExecutionPlanV1 {
  executionPlanId: string;
  tenantId: string;
  campaignId: string;
  campaignPackageVersion: number;
  planVersion: string;
  correlationId: string;
  planHash: string;
  idempotencyKey: string;
  status: ExecutionPlanStatus;
  meta: {
    connectionId: string;
    adAccountId?: string;
    assetBindings: string[];
    requiredCapabilities: MetaCapabilityType[];
  };
  objectsToCreate: Array<{
    internalObjectId: string;
    type: 'campaign' | 'ad_set' | 'creative' | 'ad';
    dependsOn: string[];
    logicalConfig: Record<string, unknown>;
  }>;
  readiness: ReadinessCheck[];
  autonomy: {
    level: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
    approvalRequired: boolean;
    approvalId?: string;
    approvedPlanHash?: string;
  };
  createdAt: string;
}
