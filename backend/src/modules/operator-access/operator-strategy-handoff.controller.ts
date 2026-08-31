import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CampaignContextInput } from '../../domain/contracts/campaign-context';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { OperatorAccessService } from './operator-access.service';
import { StrategyHandoffPersistenceService } from './strategy-handoff-persistence.service';

@Controller('operator')
export class OperatorStrategyHandoffController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly strategyPersistence: StrategyHandoffPersistenceService,
    private readonly plans: ExecutionPlanService,
    private readonly simulations: ExecutionSimulationService,
    private readonly connections: MetaConnectionService,
  ) {}

  @Post('campaign-strategies/v1/action-submit')
  @HttpCode(200)
  async submitActionEnvelope(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ): Promise<any> {
    try {
      const result = await this.submitStrategy(
        body,
        this.operatorAuthorization(authorization, operatorKey),
      );
      return {
        action_status: 'ACCEPTED',
        ...result,
      };
    } catch (error) {
      return this.httpEnvelope(error);
    }
  }

  async submitStrategy(body: unknown, authorization: string | undefined) {
    const source = this.record(body, 'strategy');
    this.assertLifecycle(source);

    const businessName = this.text(source.business_name, 'business_name', 160);
    const workspace = await this.access.listTenants(authorization);
    const candidates = workspace.tenants.filter((tenant) =>
      tenant.permissions.includes('manage_campaign_preparation'),
    );
    const matching = candidates.filter((tenant) =>
      this.normalizeName(tenant.displayName) === this.normalizeName(businessName),
    );
    const selectedTenant = matching.length === 1
      ? matching[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined;

    if (!selectedTenant) {
      throw new ConflictException({
        code: 'tenant_resolution_ambiguous',
        message: 'The authenticated operator has zero or multiple campaign-preparation tenants',
        candidateCount: candidates.length,
      });
    }

    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      selectedTenant.tenantId,
    );
    const target = await this.connections.selectedExecutionTarget(selectedTenant.tenantId);
    const contextInput = this.contextInput(source, businessName);
    const campaignId = this.deterministicCampaignId(selectedTenant.tenantId, contextInput);
    const context = await this.strategyPersistence.createOrGet(
      selectedTenant.tenantId,
      campaignId,
      contextInput,
      operator.subject,
    );
    const basePlan = await this.plans.generate(
      selectedTenant.tenantId,
      context.campaignId,
      context.version,
      operator.subject,
    );
    const finalPlan = await this.simulations.bindTarget(
      selectedTenant.tenantId,
      context.campaignId,
      basePlan.executionPlanId,
      target.connectionId,
      target.adAccountId,
    );

    const facebookPageId = this.selectedAsset(target.selectedAssets, 'facebook_page');
    const instagramAccountId = this.selectedAsset(target.selectedAssets, 'instagram_account');
    const whatsappAssetId = this.selectedAsset(target.selectedAssets, 'whatsapp');

    return {
      package_id: context.campaignId,
      package_version: context.version,
      package_hash: context.contentHash,
      campaign_id: context.campaignId,
      campaign_context_version: context.version,
      creative_package_id: null,
      creative_package_status: 'PENDING_CREATIVE_PACKAGE',
      execution_plan_id: finalPlan.executionPlanId,
      execution_plan_hash: finalPlan.planHash,
      execution_plan_status: finalPlan.status,
      target_binding_status: 'BOUND',
      idempotency_status: 'DETERMINISTIC_RETRY_SAFE',
      next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      strategy_snapshot: {
        business_name: businessName,
        offer_name: this.text(source.offer_name, 'offer_name', 500),
        offer_description: this.text(source.offer_description, 'offer_description', 2_000),
        audience_description: this.text(source.audience_description, 'audience_description', 2_000),
        locations: source.locations,
        budget_type: source.budget_type,
        budget_amount: source.budget_amount,
        currency: source.currency,
        duration_days: source.duration_days,
        creative_brief: this.optionalText(source.creative_brief, 'creative_brief', 4_000) ?? null,
        strategy_status: source.strategy_status,
        handoff_status: source.handoff_status,
      },
      resolved_context: {
        tenant_id: selectedTenant.tenantId,
        tenant_display_name: selectedTenant.displayName,
        meta_connection_id: target.connectionId,
        ad_account_id: target.adAccountId,
        facebook_page_id: facebookPageId ?? null,
        instagram_account_id: instagramAccountId ?? null,
        whatsapp_asset_id: whatsappAssetId ?? null,
      },
      boundaries: {
        persisted: true,
        creative_package_persisted: false,
        execution_plan_created: true,
        technical_target_auto_resolved: true,
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
        spend_authorized: false,
        delivery_authorized: false,
      },
    };
  }

  private contextInput(
    source: Record<string, unknown>,
    businessName: string,
  ): CampaignContextInput {
    const budgetType = source.budget_type;
    if (budgetType !== 'DAILY' && budgetType !== 'LIFETIME') {
      throw new BadRequestException('budget_type must be DAILY or LIFETIME');
    }
    const budgetAmount = this.positiveNumber(source.budget_amount, 'budget_amount');
    const amountMinor = Math.round(budgetAmount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
      throw new BadRequestException('budget_amount cannot be represented safely in minor currency units');
    }
    const currency = this.currency(source.currency);
    const durationDays = this.integer(source.duration_days, 'duration_days', 1, 365);
    const offerName = this.text(source.offer_name, 'offer_name', 500);
    const offerDescription = this.text(source.offer_description, 'offer_description', 2_000);
    const creativeBrief = this.optionalText(source.creative_brief, 'creative_brief', 4_000);
    const commercialConditions = source.commercial_conditions === undefined
      ? undefined
      : this.compactJson(source.commercial_conditions, 'commercial_conditions', 2_000);
    const offerParts = [
      `${offerName} — ${offerDescription}`,
      commercialConditions ? `Condições comerciais aprovadas: ${commercialConditions}` : undefined,
      creativeBrief ? `Briefing criativo aprovado: ${creativeBrief}` : undefined,
    ].filter(Boolean) as string[];
    const offer = offerParts.join(' | ');
    if (offer.length > 2_000) {
      throw new BadRequestException(
        'The approved offer, commercial conditions and creative brief exceed the persisted strategy limit',
      );
    }

    return {
      businessName,
      offer,
      objective: 'leads',
      audience: this.text(source.audience_description, 'audience_description', 2_000),
      destination: 'whatsapp',
      geography: this.geography(source.locations),
      budget: {
        mode: budgetType === 'DAILY' ? 'daily' : 'lifetime',
        amountMinor,
        currency,
      },
      durationDays,
    };
  }

  private assertLifecycle(source: Record<string, unknown>) {
    if (source.campaign_objective !== 'LEADS') {
      throw new BadRequestException('campaign_objective must be LEADS');
    }
    if (source.conversion_destination !== 'WHATSAPP') {
      throw new BadRequestException('conversion_destination must be WHATSAPP');
    }
    if (source.strategy_status !== 'COMPLETE') {
      throw new ConflictException('strategy_status must be COMPLETE before handoff');
    }
    if (source.handoff_status !== 'READY_FOR_GENERATOR') {
      throw new ConflictException('handoff_status must be READY_FOR_GENERATOR');
    }
  }

  private geography(value: unknown): string {
    if (!Array.isArray(value) || value.length < 1) {
      throw new BadRequestException('locations must contain at least one location');
    }
    const locations = value.map((raw, index) => {
      const item = this.record(raw, `locations[${index}]`);
      const city = this.text(item.city, `locations[${index}].city`, 160);
      const country = this.text(item.country, `locations[${index}].country`, 80);
      const state = this.optionalText(item.state, `locations[${index}].state`, 80);
      let radius = '';
      if (item.radius_km !== undefined) {
        const radiusKm = this.positiveNumber(item.radius_km, `locations[${index}].radius_km`);
        radius = ` (${radiusKm} km)`;
      }
      if (item.include !== undefined && typeof item.include !== 'boolean') {
        throw new BadRequestException(`locations[${index}].include must be a boolean`);
      }
      const mode = item.include === false ? 'Excluir' : 'Incluir';
      const region = [city, state, country].filter(Boolean).join(', ');
      return `${mode} ${region}${radius}`;
    });
    const geography = locations.join('; ');
    if (geography.length > 500) {
      throw new BadRequestException('locations exceed the persisted geography limit');
    }
    return geography;
  }

  private deterministicCampaignId(
    tenantId: string,
    contextInput: CampaignContextInput,
  ): string {
    const identity = this.stableStringify({
      tenant_id: tenantId,
      strategy: contextInput,
      identity_version: 1,
    });
    const hex = createHash('sha256').update(identity).digest('hex').slice(0, 32).split('');
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

  private record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
  }

  private text(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a non-empty string up to ${max} characters`);
    }
    return value.trim();
  }

  private optionalText(value: unknown, field: string, max: number): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return this.text(value, field, max);
  }

  private positiveNumber(value: unknown, field: string): number {
    const result = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(result) || result <= 0) {
      throw new BadRequestException(`${field} must be a positive number`);
    }
    return result;
  }

  private integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return value as number;
  }

  private currency(value: unknown): string {
    const result = this.text(value, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(result)) {
      throw new BadRequestException('currency must be a 3-letter uppercase code');
    }
    return result;
  }

  private compactJson(value: unknown, field: string, max: number): string {
    let result: string;
    try {
      result = typeof value === 'string' ? value.trim() : this.stableStringify(value);
    } catch {
      throw new BadRequestException(`${field} must be JSON-serializable`);
    }
    if (!result || result.length > max) {
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    }
    return result;
  }

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
  }

  private normalizeName(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  private selectedAsset(
    assets: Array<{ assetType: string; externalId: string }>,
    assetType: string,
  ): string | undefined {
    return assets.find((asset) => asset.assetType === assetType)?.externalId;
  }

  private httpEnvelope(error: unknown) {
    if (error instanceof HttpException) {
      return {
        action_status: 'REJECTED',
        http_status: error.getStatus(),
        error: error.getResponse(),
        boundaries: this.noWriteBoundaries(),
      };
    }
    return {
      action_status: 'REJECTED',
      http_status: 500,
      error: {
        code: 'strategy_handoff_internal_error',
        message: error instanceof Error ? error.message : 'Unexpected strategy handoff error',
      },
      boundaries: this.noWriteBoundaries(),
    };
  }

  private noWriteBoundaries() {
    return {
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
      meta_write_performed: false,
      spend_authorized: false,
      delivery_authorized: false,
    };
  }
}
