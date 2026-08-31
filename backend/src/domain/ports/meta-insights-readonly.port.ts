import { MetaCampaignInsightsV1 } from '../contracts/meta-insights';
import { MetaAdapterResult } from './meta-adapter.port';

export interface MetaInsightsReadonlyPort {
  readCampaignInsights(
    tenantId: string,
    credentialRef: string,
    expectedAdAccountId: string,
    campaignId: string,
    periodStart: string,
    periodEnd: string,
    currency: string,
  ): Promise<MetaAdapterResult<MetaCampaignInsightsV1>>;
}
