export interface MetaInsightActionV1 {
  actionType: string;
  value: number;
}

export interface MetaCampaignInsightsV1 {
  campaignId: string;
  campaignName?: string;
  adAccountId: string;
  status: string;
  effectiveStatus?: string;
  createdTime?: string;
  updatedTime?: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  impressions: number;
  reach: number;
  spendMinor: number;
  clicks: number;
  frequency?: number;
  ctr?: number;
  cpcMinor?: number;
  results: number;
  resultActionType: string | null;
  actions: MetaInsightActionV1[];
  observedAt: string;
  boundaries: {
    readonly: true;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    credentialsExposed: false;
  };
}
