import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CampaignBudget,
  CampaignContextFacts,
  CampaignContextField,
  CampaignContextInput,
  CampaignContextIssue,
  CampaignContextPackageV1,
  CampaignDestination,
  CampaignObjective,
  SourcedCampaignFact,
  UnversionedCampaignContextPackageV1,
} from '../../domain/contracts/campaign-context';
import { CampaignContextRepository } from '../../domain/ports/repositories';
import { CAMPAIGN_CONTEXT_REPOSITORY } from '../../infrastructure/database/database.tokens';

const OBJECTIVES: CampaignObjective[] = [
  'awareness', 'traffic', 'engagement', 'leads', 'app_promotion', 'sales',
];
const DESTINATIONS: CampaignDestination[] = [
  'website', 'whatsapp', 'instagram', 'messenger', 'instant_form', 'app',
  'phone', 'physical_location', 'other',
];
const REQUIRED_FIELDS: CampaignContextField[] = [
  'businessName',
  'offer',
  'objective',
  'audience',
  'destination',
  'geography',
  'budget',
  'durationDays',
];

@Injectable()
export class CampaignContextService {
  constructor(
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
  ) {}

  async create(tenantId: unknown, input?: CampaignContextInput) {
    this.assertUuid(tenantId, 'tenantId');
    const now = new Date().toISOString();
    const campaignId = randomUUID();
    const context = this.buildContext(tenantId, campaignId, input, now);
    const versioned: CampaignContextPackageV1 = { ...context, version: 1 };
    await this.contexts.create(versioned);
    return versioned;
  }

  async appendVersion(
    tenantId: unknown,
    campaignId: string,
    input?: CampaignContextInput,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const context = this.buildContext(
      tenantId,
      campaignId,
      input,
      new Date().toISOString(),
    );
    const versioned = await this.contexts.appendNext(context);
    if (!versioned) throw new NotFoundException('Campaign context not found');
    return versioned;
  }

  async latest(tenantId: string, campaignId: string) {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const context = await this.contexts.latest(tenantId, campaignId);
    if (!context) throw new NotFoundException('Campaign context not found');
    return context;
  }

  private buildContext(
    tenantId: string,
    campaignId: string,
    input: CampaignContextInput | undefined,
    now: string,
  ): UnversionedCampaignContextPackageV1 {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
      throw new BadRequestException('facts must be an object');
    }
    const facts = this.normalizeFacts(input ?? {}, now);
    const validationIssues = this.validateCompleteness(facts);
    return {
      packageId: randomUUID(),
      tenantId,
      campaignId,
      schemaVersion: '1.0',
      status: validationIssues.length === 0
        ? 'ready_for_generation'
        : 'needs_information',
      facts,
      inferences: [],
      validationIssues,
      contentHash: this.contentHash(facts),
      createdAt: now,
    };
  }

  private normalizeFacts(input: CampaignContextInput, now: string): CampaignContextFacts {
    const facts: CampaignContextFacts = {};
    const businessName = this.optionalText(input.businessName, 'businessName', 160);
    const offer = this.optionalText(input.offer, 'offer', 2_000);
    const audience = this.optionalText(input.audience, 'audience', 2_000);
    const geography = this.optionalText(input.geography, 'geography', 500);
    const objective = this.optionalEnum(input.objective, 'objective', OBJECTIVES);
    const destination = this.optionalEnum(input.destination, 'destination', DESTINATIONS);
    const durationDays = this.optionalInteger(input.durationDays, 'durationDays', 1, 365);
    const budget = this.optionalBudget(input.budget);

    if (businessName !== undefined) facts.businessName = this.sourced(businessName, now);
    if (offer !== undefined) facts.offer = this.sourced(offer, now);
    if (objective !== undefined) facts.objective = this.sourced(objective, now);
    if (audience !== undefined) facts.audience = this.sourced(audience, now);
    if (destination !== undefined) facts.destination = this.sourced(destination, now);
    if (geography !== undefined) facts.geography = this.sourced(geography, now);
    if (budget !== undefined) facts.budget = this.sourced(budget, now);
    if (durationDays !== undefined) facts.durationDays = this.sourced(durationDays, now);
    return facts;
  }

  private validateCompleteness(facts: CampaignContextFacts): CampaignContextIssue[] {
    return REQUIRED_FIELDS
      .filter((field) => facts[field] === undefined)
      .map((field) => ({
        code: 'required_fact_missing',
        field,
        severity: 'blocker',
        message: `A informação obrigatória "${field}" ainda não foi informada.`,
        nextAction: `Solicitar e registrar "${field}" antes de gerar a campanha.`,
      }));
  }

  private sourced<T>(value: T, now: string): SourcedCampaignFact<T> {
    return {
      value,
      source: 'user_input',
      evidenceRefs: ['api:user_input'],
      recordedAt: now,
    };
  }

  private optionalText(value: unknown, field: string, max: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length > max) {
      throw new BadRequestException(`${field} must have at most ${max} characters`);
    }
    return normalized;
  }

  private optionalEnum<T extends string>(
    value: unknown,
    field: string,
    allowed: T[],
  ): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
  }

  private optionalInteger(
    value: unknown,
    field: string,
    min: number,
    max: number,
  ): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return value as number;
  }

  private optionalBudget(value: unknown): CampaignBudget | undefined {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('budget must be an object');
    }
    const budget = value as Record<string, unknown>;
    if (!['daily', 'lifetime'].includes(String(budget.mode))) {
      throw new BadRequestException('budget.mode must be daily or lifetime');
    }
    if (!Number.isSafeInteger(budget.amountMinor)
      || (budget.amountMinor as number) < 1
      || (budget.amountMinor as number) > 1_000_000_000) {
      throw new BadRequestException(
        'budget.amountMinor must be an integer between 1 and 1000000000',
      );
    }
    if (typeof budget.currency !== 'string' || !/^[A-Z]{3}$/.test(budget.currency)) {
      throw new BadRequestException('budget.currency must be a 3-letter uppercase code');
    }
    return {
      mode: budget.mode as CampaignBudget['mode'],
      amountMinor: budget.amountMinor as number,
      currency: budget.currency,
    };
  }

  private contentHash(facts: CampaignContextFacts): string {
    const semanticFacts = Object.fromEntries(
      Object.entries(facts).map(([key, fact]) => [key, fact.value]),
    );
    return createHash('sha256').update(JSON.stringify(semanticFacts)).digest('hex');
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
