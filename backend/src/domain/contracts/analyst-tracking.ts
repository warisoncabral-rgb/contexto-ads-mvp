export type AnalystTrackingSource = 'execution_operation' | 'reconciled_operation';

export interface AnalystTrackingRegistrationV1 {
  registrationId: string;
  tenantId: string;
  campaignId: string;
  externalCampaignId: string;
  executionPlanId: string;
  executionManifestId: string;
  metaWriteValidationProtocolId: string;
  source: AnalystTrackingSource;
  registeredAt: string;
  updatedAt: string;
  boundaries: {
    trackingOnly: true;
    executionAuthorized: false;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    recommendationAutoExecuted: false;
  };
}
