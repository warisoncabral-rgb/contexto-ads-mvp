import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MetaAssetBindingStore,
  MetaConnectionStore,
} from '../../domain/ports/repositories';
import { META_CONNECTION_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaInsightsReadonlyAdapter } from '../meta-adapter/meta-insights-readonly.adapter';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';

@Injectable()
export class MetaInsightsService {
  constructor(
    private readonly insights: MetaInsightsReadonlyAdapter,
    private readonly readonlyMeta: MetaReadonlyAdapter,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections: MetaConnectionStore & MetaAssetBindingStore,
  ) {}

  async readSelectedCampaign(
    tenantId: string,
    campaignId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    if (!/^\d+$/.test(campaignId)) {
      throw new BadRequestException('campaignId must contain only digits');
    }
    this.assertPeriod(periodStart, periodEnd);

    const connection = await this.connections.latestReadyForTenant(tenantId);
    if (!connection || !connection.credentialRef) {
      throw new NotFoundException('Ready Meta connection with credential was not found');
    }
    const bindings = await this.connections.listBindings(tenantId, connection.connectionId);
    const selectedAccounts = bindings.filter(
      (binding) => binding.assetType === 'ad_account' && binding.selected,
    );
    if (selectedAccounts.length !== 1) {
      throw new ConflictException('Exactly one discovered ad account must be selected');
    }
    const adAccountId = selectedAccounts[0].externalId;
    const account = await this.readonlyMeta.readAdAccount(
      tenantId,
      connection.credentialRef,
      adAccountId,
    );
    if (!account.success || !account.data) return account;
    const currency = account.data.currency;
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new ConflictException('Selected Meta ad account currency is unavailable');
    }

    return this.insights.readCampaignInsights(
      tenantId,
      connection.credentialRef,
      adAccountId,
      campaignId,
      periodStart,
      periodEnd,
      currency,
    );
  }

  private assertPeriod(periodStart: string, periodEnd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)
      || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      throw new BadRequestException('Insight period must use YYYY-MM-DD');
    }
    const start = Date.parse(`${periodStart}T00:00:00Z`);
    const end = Date.parse(`${periodEnd}T00:00:00Z`);
    const days = Math.floor((end - start) / 86_400_000) + 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || days < 1 || days > 31) {
      throw new BadRequestException('Insight period must contain between 1 and 31 days');
    }
  }

  private assertUuid(value: string, field: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
