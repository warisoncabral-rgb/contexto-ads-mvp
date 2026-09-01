import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CampaignContextRepository } from '../../domain/ports/repositories';
import { CAMPAIGN_CONTEXT_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { CampaignMediaService } from './campaign-media.service';
import { OperatorAccessService } from './operator-access.service';

@Injectable()
export class CampaignAutomationService {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly status: CampaignPackageStatusService,
    private readonly media: CampaignMediaService,
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
  ) {}

  async prepareCreative(body: unknown, authorization: string | undefined) {
    const source = this.record(body, 'creative request');
    const packageId = this.uuid(source.package_id, 'package_id');
    const campaignId = this.uuid(source.campaign_id, 'campaign_id');
    if (packageId !== campaignId) throw new BadRequestException('package_id and campaign_id must match');
    const tenant = await this.resolveTenant(authorization, 'manage_campaign_preparation');
    const packageStatus = await this.status.get(tenant.tenantId, packageId);
    const currentPlanId = packageStatus.execution_plan.execution_plan_id;
    const assetIds = this.stringArray(source.asset_ids, 'asset_ids', 1, 10);
    const assets = await this.media.ingestActionFiles(
      tenant.tenantId,
      source.openaiFileIdRefs,
      assetIds,
    );
    const creative = {
      copies: this.array(source.copies, 'copies', 1, 10),
      claims: this.array(source.claims, 'claims', 0, 50),
      assets: assets.map((asset) => ({
        assetId: asset.assetId,
        storageRef: asset.storageRef,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      })),
      reviewChecklist: this.record(source.reviewChecklist, 'reviewChecklist'),
    };

    let latest: any = null;
    try { latest = await this.access.latestCreativePackage(authorization, tenant.tenantId, campaignId); }
    catch (error) { if (!(error instanceof NotFoundException)) throw error; }
    if (latest && this.sameCreative(latest, creative)) {
      return {
        action_status: 'READY_FOR_REVIEW',
        creative_package: latest,
        execution_plan_id: currentPlanId,
        idempotency_status: 'EXACT_CREATIVE_REUSED',
        media_auto_resolved: true,
        tenant_auto_resolved: true,
        next_action: 'GET_FINAL_CAMPAIGN_REVIEW',
        boundaries: this.noWriteBoundaries(),
      };
    }

    const created = await this.access.appendCreativePackage(
      authorization,
      tenant.tenantId,
      campaignId,
      currentPlanId,
      creative,
    );
    return {
      action_status: 'READY_FOR_REVIEW',
      creative_package: created.creativePackage,
      execution_plan_id: created.executionPlan.executionPlanId,
      readiness: created.readiness,
      idempotency_status: 'NEW_CREATIVE_VERSION_CREATED',
      media_auto_resolved: true,
      tenant_auto_resolved: true,
      next_action: 'GET_FINAL_CAMPAIGN_REVIEW',
      boundaries: this.noWriteBoundaries(),
    };
  }

  async creativeReview(body: unknown, authorization: string | undefined) {
    const source = this.record(body, 'creative review request');
    const packageId = this.uuid(source.package_id, 'package_id');
    const tenant = await this.resolveTenant(authorization, 'manage_campaign_preparation');
    const creative = await this.access.latestCreativePackage(authorization, tenant.tenantId, packageId);
    const packageStatus = await this.status.get(tenant.tenantId, packageId);
    return {
      action_status: 'FOUND',
      creative_package: creative,
      execution_plan_id: packageStatus.execution_plan.execution_plan_id,
      next_action: 'GET_FINAL_CAMPAIGN_REVIEW',
      boundaries: this.noWriteBoundaries(),
    };
  }

  async finalReview(body: unknown, authorization: string | undefined) {
    const source = this.record(body, 'final review request');
    const packageId = this.uuid(source.package_id, 'package_id');
    const tenant = await this.resolveTenant(authorization, 'manage_campaign_preparation');
    return this.buildFinalReview(tenant.tenantId, packageId, authorization);
  }

  async finalizeForPublication(body: unknown, authorization: string | undefined) {
    const source = this.record(body, 'finalization request');
    const packageId = this.uuid(source.package_id, 'package_id');
    const reviewHash = this.sha256(source.review_hash, 'review_hash');
    if (source.confirmation !== 'CONFIRM_AND_PREPARE_FOR_PUBLICATION') {
      throw new BadRequestException({
        code: 'explicit_final_confirmation_required',
        message: 'A confirmação final explícita da configuração da campanha é obrigatória.',
      });
    }
    const tenant = await this.resolveTenant(authorization, 'decide_approval');
    const review = await this.buildFinalReview(tenant.tenantId, packageId, authorization);
    if (review.final_review.review_hash !== reviewHash) {
      throw new ConflictException({
        code: 'final_review_changed',
        message: 'A campanha mudou depois da revisão. Uma nova revisão final é necessária.',
      });
    }

    let creative = await this.access.latestCreativePackage(authorization, tenant.tenantId, packageId);
    let currentPlanId = review.execution_plan_id;
    if (creative.status !== 'approved') {
      const approvedCreative = await this.access.approveCreativePackage(
        authorization,
        tenant.tenantId,
        packageId,
        creative.version,
        creative.contentHash,
      );
      creative = approvedCreative.creativePackage;
      currentPlanId = approvedCreative.executionPlan.executionPlanId;
    }

    const approvalRequest = await this.access.requestPlanApproval(
      authorization,
      tenant.tenantId,
      packageId,
      currentPlanId,
    );
    const approvalId = approvalRequest.approval.approvalId;
    const planApproval = approvalRequest.approval.status === 'approved'
      ? approvalRequest
      : await this.access.decidePlanApproval(
        authorization,
        tenant.tenantId,
        approvalId,
        'approve',
      );

    const manifest = await this.access.prepareExecutionManifest(
      authorization,
      tenant.tenantId,
      packageId,
      currentPlanId,
      approvalId,
    );
    const protocol = await this.access.prepareMetaWriteValidation(
      authorization,
      tenant.tenantId,
      manifest.executionManifestId,
    );
    const executionAuthorization = await this.access.requestExecutionAuthorization(
      authorization,
      tenant.tenantId,
      manifest.executionManifestId,
    );
    const approvedExecutionAuthorization = executionAuthorization.status === 'approved'
      ? executionAuthorization
      : await this.access.decideExecutionAuthorization(
        authorization,
        tenant.tenantId,
        executionAuthorization.executionAuthorizationId,
        'approve',
      );

    await this.access.changeKillSwitch(
      authorization,
      tenant.tenantId,
      'tenant',
      undefined,
      'released',
      'Validação controlada da publicação em estado PAUSED após confirmação final do usuário.',
    );
    await this.access.changeKillSwitch(
      authorization,
      tenant.tenantId,
      'campaign',
      packageId,
      'released',
      'Validação controlada da publicação em estado PAUSED após confirmação final do usuário.',
    );

    const preflight = await this.access.runExecutionPreflight(
      authorization,
      tenant.tenantId,
      approvedExecutionAuthorization.executionAuthorizationId,
    );
    if (preflight.blockers.length) {
      throw new ConflictException({
        code: 'publication_preflight_blocked',
        message: 'A campanha não passou pela validação técnica anterior à publicação.',
        blockers: preflight.blockers,
      });
    }
    const execution = await this.access.executeMetaPausedCreation(
      authorization,
      tenant.tenantId,
      approvedExecutionAuthorization.executionAuthorizationId,
    );
    if (execution.status !== 'external_validation_succeeded') {
      throw new ConflictException({
        code: 'paused_publication_validation_failed',
        message: 'A validação real na Meta não foi concluída com todos os objetos em PAUSED.',
        protocol_status: execution.status,
      });
    }
    const readyHash = this.hash({
      package_id: packageId,
      creative_hash: creative.contentHash,
      plan_hash: manifest.planHash,
      manifest_hash: manifest.manifestHash,
      protocol_hash: execution.protocolHash,
    });
    return {
      action_status: 'READY_TO_PUBLISH',
      package_id: packageId,
      campaign_id: packageId,
      creative_package: {
        id: creative.creativePackageId,
        version: creative.version,
        status: creative.status,
        content_hash: creative.contentHash,
      },
      execution_plan_id: currentPlanId,
      plan_approval_status: planApproval.approval.status,
      execution_manifest_id: manifest.executionManifestId,
      meta_validation_status: execution.status,
      meta_objects: execution.execution?.operations.map((operation) => ({
        object_type: operation.objectType,
        external_object_id: operation.externalObjectId ?? null,
        observed_status: operation.observedStatus ?? null,
      })) ?? [],
      ready_hash: readyHash,
      next_action: 'AWAIT_EXPLICIT_PUBLISH_COMMAND',
      human_message: 'A campanha foi criada e validada na Meta em estado pausado. Nenhum anúncio está entregando. Para iniciar a campanha, basta confirmar a publicação.',
      boundaries: {
        publication_authorized: false,
        campaign_active: false,
        delivery_authorized: false,
        spend_authorized: false,
        external_writes_performed: true,
        all_created_objects_validated_paused: true,
      },
    };
  }

  private async buildFinalReview(
    tenantId: string,
    packageId: string,
    authorization: string | undefined,
  ) {
    const context = await this.contexts.latest(tenantId, packageId);
    if (!context) throw new NotFoundException('Campaign package not found');
    const creative = await this.access.latestCreativePackage(authorization, tenantId, packageId);
    const packageStatus = await this.status.get(tenantId, packageId);
    if (creative.validationIssues.length) {
      throw new ConflictException({
        code: 'creative_review_incomplete',
        message: 'Os criativos ainda possuem verificações pendentes.',
        validation_issues: creative.validationIssues,
      });
    }
    const facts = context.facts;
    const semantic = {
      package_id: packageId,
      context_hash: context.contentHash,
      creative_hash: creative.contentHash,
      plan_hash: packageStatus.execution_plan.plan_hash,
    };
    const reviewHash = this.hash(semantic);
    const budget = facts.budget?.value;
    const maximumMinor = packageStatus.execution_plan.maximum_planned_spend_minor;
    return {
      action_status: 'FINAL_REVIEW_REQUIRED',
      package_id: packageId,
      campaign_id: packageId,
      execution_plan_id: packageStatus.execution_plan.execution_plan_id,
      final_review: {
        review_hash: reviewHash,
        business: facts.businessName?.value ?? null,
        objective: 'Leads → WhatsApp',
        direction: facts.geography?.value ?? null,
        audience: facts.audience?.value ?? null,
        offer_and_logistics: facts.offer?.value ?? null,
        budget: budget ? {
          mode: budget.mode === 'daily' ? 'diário' : 'vitalício',
          amount: budget.amountMinor / 100,
          currency: budget.currency,
          duration_days: facts.durationDays?.value ?? null,
          maximum_planned_amount: maximumMinor / 100,
        } : null,
        creatives: creative.copies.map((copy, index) => ({
          variant: index + 1,
          copy_id: copy.copyId,
          headline: copy.headline,
          primary_text: copy.primaryText,
          description: copy.description ?? null,
          whatsapp_message: copy.whatsappMessage ?? null,
          call_to_action: copy.callToAction,
          asset: creative.assets[index] ? {
            asset_id: creative.assets[index].assetId,
            mime_type: creative.assets[index].mimeType,
            width: creative.assets[index].width,
            height: creative.assets[index].height,
          } : null,
        })),
        billing: {
          planned_total: maximumMinor / 100,
          currency: packageStatus.execution_plan.currency,
          instruction: 'A cobrança utilizará a forma de pagamento já configurada na conta de anúncios Meta. Se a conta operar com saldo pré-pago, a adição de saldo é feita na área de Pagamentos da Meta antes da ativação.',
        },
      },
      confirmation_items: [
        'Confirmar o direcionamento geográfico e o público.',
        'Confirmar a oferta e as condições de logística/frete.',
        'Confirmar os textos e os criativos selecionados.',
        'Confirmar o orçamento e a duração da campanha.',
      ],
      next_action: 'AWAIT_FINAL_USER_CONFIRMATION',
      boundaries: this.noWriteBoundaries(),
    };
  }

  private async resolveTenant(authorization: string | undefined, permission: string) {
    const workspace = await this.access.listTenants(authorization);
    const candidates = workspace.tenants.filter((tenant) => tenant.permissions.includes(permission as any));
    if (candidates.length !== 1) {
      throw new ConflictException({
        code: 'tenant_resolution_ambiguous',
        message: 'Não foi possível determinar automaticamente a empresa autorizada para esta campanha.',
        candidate_count: candidates.length,
      });
    }
    return candidates[0];
  }

  private sameCreative(latest: any, creative: any) {
    return this.stableStringify({
      copies: latest.copies,
      claims: latest.claims,
      assets: latest.assets,
      reviewChecklist: latest.reviewChecklist,
    }) === this.stableStringify(creative);
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

  private record(value: unknown, field: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an object`);
    }
    return value as Record<string, any>;
  }

  private array(value: unknown, field: string, min: number, max: number): any[] {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      throw new BadRequestException(`${field} must contain between ${min} and ${max} items`);
    }
    return value;
  }

  private stringArray(value: unknown, field: string, min: number, max: number): string[] {
    const array = this.array(value, field, min, max);
    return array.map((item, index) => {
      if (typeof item !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(item)) {
        throw new BadRequestException(`${field}[${index}] is invalid`);
      }
      return item;
    });
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private sha256(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a SHA-256 digest`);
    }
    return value.toLowerCase();
  }

  private hash(value: unknown) {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: any): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}
