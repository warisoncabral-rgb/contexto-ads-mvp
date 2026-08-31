import { Inject, Injectable } from '@nestjs/common';
import { AnalystTrackingRegistrationV1 } from '../../domain/contracts/analyst-tracking';
import {
  ExecutionManifestRepository,
  ExecutionPlanRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_MANIFEST_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { AnalystTrackingService } from '../analyst-tracking/analyst-tracking.service';

export interface ResolvedMetaCampaignV1 {
  externalCampaignId: string;
  executionPlanId: string;
  executionManifestId: string;
  protocolId: string;
  source: 'execution_operation' | 'reconciled_operation';
}

@Injectable()
export class AnalystMetaCampaignResolverService {
  constructor(
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly protocols: MetaWriteValidationProtocolRepository,
    private readonly tracking: AnalystTrackingService,
  ) {}

  async resolve(tenantId: string, campaignId: string): Promise<ResolvedMetaCampaignV1 | null> {
    const registered = await this.tracking.find(tenantId, campaignId);
    if (registered) return this.fromRegistration(registered);

    const plan = await this.plans.latest(tenantId, campaignId);
    if (!plan) return null;
    const manifest = await this.manifests.latestForPlan(tenantId, plan.executionPlanId);
    if (!manifest) return null;
    const protocol = await this.protocols.latestForManifest(
      tenantId,
      manifest.executionManifestId,
    );
    if (!protocol || protocol.status !== 'external_validation_succeeded') return null;

    const ensured = await this.tracking.ensureFromProtocol(protocol);
    return ensured ? this.fromRegistration(ensured) : null;
  }

  private fromRegistration(registration: AnalystTrackingRegistrationV1): ResolvedMetaCampaignV1 {
    return {
      externalCampaignId: registration.externalCampaignId,
      executionPlanId: registration.executionPlanId,
      executionManifestId: registration.executionManifestId,
      protocolId: registration.metaWriteValidationProtocolId,
      source: registration.source,
    };
  }
}
