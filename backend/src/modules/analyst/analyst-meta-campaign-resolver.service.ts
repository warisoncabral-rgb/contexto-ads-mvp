import { Inject, Injectable } from '@nestjs/common';
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
  ) {}

  async resolve(tenantId: string, campaignId: string): Promise<ResolvedMetaCampaignV1 | null> {
    const plan = await this.plans.latest(tenantId, campaignId);
    if (!plan) return null;
    const manifest = await this.manifests.latestForPlan(tenantId, plan.executionPlanId);
    if (!manifest) return null;
    const protocol = await this.protocols.latestForManifest(
      tenantId,
      manifest.executionManifestId,
    );
    if (!protocol) return null;

    const executed = protocol.execution?.operations.find((operation) =>
      operation.objectType === 'campaign'
      && operation.status === 'succeeded'
      && typeof operation.externalObjectId === 'string'
      && /^\d+$/.test(operation.externalObjectId));
    if (executed?.externalObjectId) {
      return {
        externalCampaignId: executed.externalObjectId,
        executionPlanId: plan.executionPlanId,
        executionManifestId: manifest.executionManifestId,
        protocolId: protocol.metaWriteValidationProtocolId,
        source: 'execution_operation',
      };
    }

    const reconciled = protocol.reconciledOperations?.find((operation) =>
      operation.objectType === 'campaign'
      && typeof operation.externalObjectId === 'string'
      && /^\d+$/.test(operation.externalObjectId));
    if (reconciled?.externalObjectId) {
      return {
        externalCampaignId: reconciled.externalObjectId,
        executionPlanId: plan.executionPlanId,
        executionManifestId: manifest.executionManifestId,
        protocolId: protocol.metaWriteValidationProtocolId,
        source: 'reconciled_operation',
      };
    }

    return null;
  }
}
