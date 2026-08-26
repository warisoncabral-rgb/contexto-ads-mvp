import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CampaignContextFacts,
  CampaignContextPackageV1,
  SourcedCampaignFact,
  UnversionedCampaignContextPackageV1,
} from '../../domain/contracts/campaign-context';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { CampaignContextRepository } from '../../domain/ports/repositories';
import { CAMPAIGN_CONTEXT_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';
import { CampaignPackageMapper } from './campaign-package.mapper';

export interface CampaignPackageHandoffResultV1 {
  package_id: string;
  package_version: number;
  package_hash: string;
  campaign_id: string;
  campaign_context_version: number;
  execution_plan_id: string;
  execution_plan_hash: string;
  execution_plan_status: string;
  creative_package_input: unknown;
  execution_target_hints: unknown;
  next_action: 'REVIEW_CREATIVE_AND_EXECUTION_PLAN';
  boundaries: {
    persisted: true;
    execution_plan_created: true;
    meta_write_performed: false;
    spend_authorized: false;
    delivery_authorized: false;
  };
}

@Injectable()
export class CampaignPackageHandoffService {
  constructor(
    private readonly mapper: CampaignPackageMapper,
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
    private readonly executionPlans: ExecutionPlanService,
  ) {}

  async submit(
    tenantId: unknown,
    input: unknown,
    actor: unknown,
  ): Promise<CampaignPackageHandoffResultV1> {
    this.assertUuid(tenantId, 'tenantId');
    const operatorSubject = this.assertActor(actor);
    const prepared = this.mapper.prepare(input);
    const campaignId = prepared.package_id;
    const context = await this.persistContextVersion(
      tenantId,
      campaignId,
      prepared.package_id,
      prepared.package_version,
      prepared.package_hash,
      prepared.generator_inputs.campaign_context,
      operatorSubject,
    );
    const plan = await this.executionPlans.generate(
      tenantId,
      campaignId,
      context.version,
      operatorSubject,
    );

    return {
      package_id: prepared.package_id,
      package_version: prepared.package_version,
      package_hash: prepared.package_hash,
      campaign_id: campaignId,
      campaign_context_version: context.version,
      execution_plan_id: plan.executionPlanId,
      execution_plan_hash: plan.planHash,
      execution_plan_status: plan.status,
      creative_package_input: prepared.generator_inputs.creative_package,
      execution_target_hints: prepared.generator_inputs.execution_target_hints,
      next_action: 'REVIEW_CREATIVE_AND_EXECUTION_PLAN',
      boundaries: {
        persisted: true,
        execution_plan_created: true,
        meta_write_performed: false,
        spend_authorized: false,
        delivery_authorized: false,
      },
    };
  }

  private async persistContextVersion(
    tenantId: string,
    campaignId: string,
    packageId: string,
    packageVersion: number,
    packageHash: string,
    input: import('../../domain/contracts/campaign-context').CampaignContextInput,
    actor: string,
  ): Promise<CampaignContextPackageV1> {
    const existing = await this.contexts.findVersion(tenantId, campaignId, packageVersion);
    const now = new Date().toISOString();
    const facts = this.toFacts(input, now, packageId, packageVersion);
    const contentHash = this.hashFacts(facts);
    if (existing) {
      if (existing.contentHash !== contentHash) {
        throw new ConflictException({
          code: 'campaign_package_version_conflict',
          message: 'The same package version was already submitted with different content',
          packageId,
          packageVersion,
        });
      }
      return existing;
    }

    const latest = await this.contexts.latest(tenantId, campaignId);
    if (packageVersion === 1) {
      if (latest) {
        throw new ConflictException({
          code: 'campaign_package_version_conflict',
          message: 'Campaign already contains a different first version',
        });
      }
      const context: CampaignContextPackageV1 = {
        packageId,
        tenantId,
        campaignId,
        version: 1,
        schemaVersion: '1.0',
        status: 'ready_for_generation',
        facts,
        inferences: [],
        validationIssues: [],
        contentHash,
        createdAt: now,
      };
      await this.contexts.create(
        context,
        this.event(context, actor, packageHash, now),
      );
      return context;
    }

    if (!latest || latest.version !== packageVersion - 1) {
      throw new ConflictException({
        code: 'campaign_package_version_gap',
        message: 'Campaign Package versions must be submitted in order',
        expectedVersion: (latest?.version ?? 0) + 1,
        receivedVersion: packageVersion,
      });
    }

    const draft: UnversionedCampaignContextPackageV1 = {
      packageId,
      tenantId,
      campaignId,
      schemaVersion: '1.0',
      status: 'ready_for_generation',
      facts,
      inferences: [],
      validationIssues: [],
      contentHash,
      createdAt: now,
    };
    const appended = await this.contexts.appendNext(
      draft,
      this.event(draft, actor, packageHash, now),
    );
    if (!appended || appended.version !== packageVersion) {
      throw new ConflictException({
        code: 'campaign_package_version_race',
        message: 'Campaign Package version changed while the handoff was being persisted',
      });
    }
    return appended;
  }

  private toFacts(
    input: import('../../domain/contracts/campaign-context').CampaignContextInput,
    now: string,
    packageId: string,
    version: number,
  ): CampaignContextFacts {
    const evidence = [`campaign_package:${packageId}:v${version}`];
    const sourced = <T>(value: T): SourcedCampaignFact<T> => ({
      value,
      source: 'user_input',
      evidenceRefs: evidence,
      recordedAt: now,
    });
    return {
      businessName: sourced(input.businessName as string),
      offer: sourced(input.offer as string),
      objective: sourced(input.objective as 'leads'),
      audience: sourced(input.audience as string),
      destination: sourced(input.destination as 'whatsapp'),
      geography: sourced(input.geography as string),
      budget: sourced(input.budget as import('../../domain/contracts/campaign-context').CampaignBudget),
      durationDays: sourced(input.durationDays as number),
    };
  }

  private hashFacts(facts: CampaignContextFacts): string {
    const semantic = Object.fromEntries(
      Object.entries(facts).map(([key, fact]) => [key, fact?.value]),
    );
    return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
  }

  private event(
    context: UnversionedCampaignContextPackageV1,
    actor: string,
    packageHash: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: context.tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: actor,
      eventType: 'campaign_package_handoff_persisted',
      objectType: 'campaign_context_package',
      objectId: context.packageId,
      newState: {
        campaignId: context.campaignId,
        packageHash,
        contentHash: context.contentHash,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'success',
      createdAt,
    };
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }

  private assertActor(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > 255) {
      throw new BadRequestException('actor must be a non-empty identifier');
    }
    return value;
  }
}
