import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
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
  'website', 'whatsapp', 'instagram', 'facebook_page', 'messenger',
  'instant_form', 'app', 'phone', 'physical_location', 'other',
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
const FIELD_LABELS: Record<CampaignContextField, string> = {
  businessName: 'nome do negócio',
  offer: 'produto ou serviço anunciado',
  objective: 'objetivo principal',
  audience: 'público desejado',
  destination: 'destino do contato',
  geography: 'local de veiculação',
  budget: 'orçamento',
  durationDays: 'duração da campanha',
  whatsappNumber: 'número do WhatsApp que receberá as mensagens',
  instagramAccount: 'conta do Instagram (@, nome ou link)',
  instagramUrl: 'link do perfil do Instagram',
  facebookPage: 'Página do Facebook (nome ou link)',
  facebookPageUrl: 'link da Página do Facebook',
  websiteUrl: 'site de destino',
  phoneNumber: 'telefone de destino',
  appUrl: 'link do aplicativo ou da loja',
};

@Injectable()
export class CampaignContextService {
  constructor(
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
  ) {}

  async create(
    tenantId: unknown,
    input?: CampaignContextInput,
    operatorSubject?: string,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    const now = new Date().toISOString();
    const campaignId = randomUUID();
    const context = this.buildContext(
      tenantId,
      campaignId,
      input,
      now,
      operatorSubject === undefined,
    );
    const versioned: CampaignContextPackageV1 = { ...context, version: 1 };
    if (operatorSubject) {
      await this.contexts.create(
        versioned,
        this.changeEvent(versioned, operatorSubject, 'created'),
      );
    } else {
      await this.contexts.create(versioned);
    }
    return versioned;
  }

  async appendVersion(
    tenantId: unknown,
    campaignId: string,
    input?: CampaignContextInput,
    operatorSubject?: string,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const context = this.buildContext(
      tenantId,
      campaignId,
      input,
      new Date().toISOString(),
      operatorSubject === undefined,
    );
    const versioned = operatorSubject
      ? await this.contexts.appendNext(
        context,
        this.changeEvent(context, operatorSubject, 'updated'),
      )
      : await this.contexts.appendNext(context);
    if (!versioned) throw new NotFoundException('Campaign context not found');
    return versioned;
  }

  private changeEvent(
    context: UnversionedCampaignContextPackageV1,
    operatorSubject: string,
    action: 'created' | 'updated',
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: context.tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: `operator_campaign_context_${action}`,
      objectType: 'campaign_context_package',
      objectId: context.packageId,
      newState: {
        campaignId: context.campaignId,
        status: context.status,
        blockerCount: context.validationIssues.length,
        contentHash: context.contentHash,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'success',
      createdAt: context.createdAt,
    };
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
    requireDestinationDetail = true,
  ): UnversionedCampaignContextPackageV1 {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
      throw new BadRequestException('facts must be an object');
    }
    const facts = this.normalizeFacts(input ?? {}, now);
    const validationIssues = this.validateCompleteness(facts, requireDestinationDetail);
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
    const whatsappNumber = this.optionalContact(input.whatsappNumber, 'whatsappNumber');
    const instagramAccount = this.optionalText(input.instagramAccount, 'instagramAccount', 500);
    const instagramUrl = this.optionalSocialUrl(input.instagramUrl, 'instagramUrl', ['instagram.com']);
    const facebookPage = this.optionalText(input.facebookPage, 'facebookPage', 500);
    const facebookPageUrl = this.optionalSocialUrl(
      input.facebookPageUrl,
      'facebookPageUrl',
      ['facebook.com', 'fb.com'],
    );
    const websiteUrl = this.optionalUrl(input.websiteUrl, 'websiteUrl');
    const phoneNumber = this.optionalContact(input.phoneNumber, 'phoneNumber');
    const appUrl = this.optionalUrl(input.appUrl, 'appUrl');

    if (businessName !== undefined) facts.businessName = this.sourced(businessName, now);
    if (offer !== undefined) facts.offer = this.sourced(offer, now);
    if (objective !== undefined) facts.objective = this.sourced(objective, now);
    if (audience !== undefined) facts.audience = this.sourced(audience, now);
    if (destination !== undefined) facts.destination = this.sourced(destination, now);
    if (geography !== undefined) facts.geography = this.sourced(geography, now);
    if (budget !== undefined) facts.budget = this.sourced(budget, now);
    if (durationDays !== undefined) facts.durationDays = this.sourced(durationDays, now);
    if (whatsappNumber !== undefined) facts.whatsappNumber = this.sourced(whatsappNumber, now);
    if (instagramAccount !== undefined) facts.instagramAccount = this.sourced(instagramAccount, now);
    if (instagramUrl !== undefined) facts.instagramUrl = this.sourced(instagramUrl, now);
    if (facebookPage !== undefined) facts.facebookPage = this.sourced(facebookPage, now);
    if (facebookPageUrl !== undefined) facts.facebookPageUrl = this.sourced(facebookPageUrl, now);
    if (websiteUrl !== undefined) facts.websiteUrl = this.sourced(websiteUrl, now);
    if (phoneNumber !== undefined) facts.phoneNumber = this.sourced(phoneNumber, now);
    if (appUrl !== undefined) facts.appUrl = this.sourced(appUrl, now);
    return facts;
  }

  private validateCompleteness(
    facts: CampaignContextFacts,
    requireDestinationDetail: boolean,
  ): CampaignContextIssue[] {
    const issues: CampaignContextIssue[] = REQUIRED_FIELDS
      .filter((field) => facts[field] === undefined)
      .map((field) => ({
        code: 'required_fact_missing',
        field,
        severity: 'blocker',
        message: `A informação obrigatória "${FIELD_LABELS[field]}" ainda não foi informada.`,
        nextAction: `Informar ${FIELD_LABELS[field]} antes de gerar a campanha.`,
      }));

    if (!requireDestinationDetail) return issues;

    const missing = this.missingDestinationDetail(facts);
    if (missing) {
      issues.push({
        code: 'required_destination_detail_missing',
        field: missing.field,
        severity: 'blocker',
        message: missing.message,
        nextAction: missing.nextAction,
      });
    }
    return issues;
  }

  private missingDestinationDetail(facts: CampaignContextFacts): {
    field: CampaignContextField;
    message: string;
    nextAction: string;
  } | undefined {
    switch (facts.destination?.value) {
      case 'whatsapp':
        if (!facts.whatsappNumber) return this.destinationIssue(
          'whatsappNumber',
          'Qual número de WhatsApp deve receber as mensagens desta campanha?',
        );
        return undefined;
      case 'instagram':
        if (!facts.instagramUrl && !facts.instagramAccount) return this.destinationIssue(
          'instagramAccount',
          'Qual perfil do Instagram deve receber essa campanha? Pode enviar o @, o nome ou o link do perfil.',
        );
        return undefined;
      case 'facebook_page':
      case 'messenger':
      case 'instant_form':
        if (!facts.facebookPageUrl && !facts.facebookPage) return this.destinationIssue(
          'facebookPage',
          'Qual Página do Facebook deve ser usada? Pode enviar o nome ou o link direto da Página.',
        );
        return undefined;
      case 'website':
        if (!facts.websiteUrl) return this.destinationIssue(
          'websiteUrl',
          'Qual é o link do site ou da página de destino?',
        );
        return undefined;
      case 'phone':
        if (!facts.phoneNumber) return this.destinationIssue(
          'phoneNumber',
          'Qual telefone deve receber os contatos desta campanha?',
        );
        return undefined;
      case 'app':
        if (!facts.appUrl) return this.destinationIssue(
          'appUrl',
          'Qual é o link do aplicativo ou da página dele na loja?',
        );
        return undefined;
      default:
        return undefined;
    }
  }

  private destinationIssue(field: CampaignContextField, prompt: string) {
    return {
      field,
      message: `Antes de preparar a campanha, preciso confirmar o destino. ${prompt}`,
      nextAction: `${prompt} Registrar a resposta antes de continuar.`,
    };
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

  private optionalContact(value: unknown, field: string): string | undefined {
    const text = this.optionalText(value, field, 40);
    if (text === undefined) return undefined;
    const normalized = text.replace(/[\s().-]/g, '');
    if (!/^\+?\d{8,20}$/.test(normalized)) {
      throw new BadRequestException(`${field} must contain a valid phone number with area/country code when applicable`);
    }
    return normalized;
  }

  private optionalSocialUrl(
    value: unknown,
    field: string,
    hosts: string[],
  ): string | undefined {
    const url = this.optionalUrl(value, field);
    if (url === undefined) return undefined;
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      throw new BadRequestException(`${field} must point to an expected social network domain`);
    }
    return url;
  }

  private optionalUrl(value: unknown, field: string): string | undefined {
    const text = this.optionalText(value, field, 500);
    if (text === undefined) return undefined;
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
      return url.toString();
    } catch {
      throw new BadRequestException(`${field} must be a valid http or https URL`);
    }
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
