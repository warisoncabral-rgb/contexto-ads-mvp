import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  CampaignBudget,
  CampaignContextFacts,
  CampaignContextInput,
  CampaignContextPackageV1,
  SourcedCampaignFact,
} from '../../domain/contracts/campaign-context';
import { CampaignContextRepository } from '../../domain/ports/repositories';
import { CAMPAIGN_CONTEXT_REPOSITORY } from '../../infrastructure/database/database.tokens';

@Injectable()
export class StrategyHandoffPersistenceService {
  constructor(
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
  ) {}

  async createOrGet(
    tenantId: string,
    campaignId: string,
    input: CampaignContextInput,
    actor: string,
  ): Promise<CampaignContextPackageV1> {
    const now = new Date().toISOString();
    const context = this.buildContext(tenantId, campaignId, input, now);
    const existing = await this.contexts.findVersion(tenantId, campaignId, 1);
    if (existing) return this.assertSame(existing, context);

    try {
      await this.contexts.create(
        context,
        this.event(context, actor, now),
      );
      return context;
    } catch (error) {
      const raced = await this.contexts.findVersion(tenantId, campaignId, 1);
      if (raced) return this.assertSame(raced, context);
      throw error;
    }
  }

  private buildContext(
    tenantId: string,
    campaignId: string,
    input: CampaignContextInput,
    now: string,
  ): CampaignContextPackageV1 {
    const sourced = <T>(value: T): SourcedCampaignFact<T> => ({
      value,
      source: 'user_input',
      evidenceRefs: [`strategy_handoff:${campaignId}:v1`],
      recordedAt: now,
    });
    const facts: CampaignContextFacts = {
      businessName: sourced(input.businessName as string),
      offer: sourced(input.offer as string),
      objective: sourced('leads' as const),
      audience: sourced(input.audience as string),
      destination: sourced('whatsapp' as const),
      geography: sourced(input.geography as string),
      budget: sourced(input.budget as CampaignBudget),
      durationDays: sourced(input.durationDays as number),
    };
    const semantic = Object.fromEntries(
      Object.entries(facts).map(([key, fact]) => [key, fact?.value]),
    );
    const contentHash = createHash('sha256')
      .update(this.stableStringify(semantic))
      .digest('hex');

    return {
      packageId: this.uuidFrom(`${campaignId}:context:v1`),
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
  }

  private assertSame(
    existing: CampaignContextPackageV1,
    candidate: CampaignContextPackageV1,
  ): CampaignContextPackageV1 {
    if (existing.contentHash !== candidate.contentHash) {
      throw new ConflictException({
        code: 'strategy_handoff_identity_conflict',
        message: 'The same deterministic campaign identity already exists with different approved strategy content',
        campaignId: candidate.campaignId,
      });
    }
    return existing;
  }

  private event(
    context: CampaignContextPackageV1,
    actor: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: context.tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: actor,
      eventType: 'operator_strategy_handoff_persisted',
      objectType: 'campaign_context_package',
      objectId: context.packageId,
      newState: {
        campaignId: context.campaignId,
        contextVersion: context.version,
        contentHash: context.contentHash,
        deterministicIdentity: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'success',
      createdAt,
    };
  }

  private uuidFrom(value: string): string {
    const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
    hex[12] = '4';
    hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
    const normalized = hex.join('');
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}
