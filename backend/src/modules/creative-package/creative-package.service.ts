import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  CreativeAssetV1,
  CreativeCallToAction,
  CreativeClaimV1,
  CreativeCopyV1,
  CreativePackageInputV1,
  CreativePackageV1,
  CreativeReviewChecklistV1,
  UnversionedCreativePackageV1,
} from '../../domain/contracts/creative-package';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  CreativePackageRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import {
  APPROVAL_REPOSITORY,
  CREATIVE_PACKAGE_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
} from '../../infrastructure/database/database.tokens';

const CTAS: CreativeCallToAction[] = [
  'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'SEND_WHATSAPP_MESSAGE',
];
const MIME_TYPES: CreativeAssetV1['mimeType'][] = [
  'image/jpeg', 'image/png', 'video/mp4',
];

@Injectable()
export class CreativePackageService {
  constructor(
    @Inject(CREATIVE_PACKAGE_REPOSITORY)
    private readonly packages: CreativePackageRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(APPROVAL_REPOSITORY)
    private readonly approvals: ApprovalRepository,
  ) {}

  async appendVersion(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    input: CreativePackageInputV1 | undefined,
    createdBy: unknown,
  ): Promise<{ creativePackage: CreativePackageV1; executionPlan: ExecutionPlanV1 }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    const actor = this.assertActor(createdBy, 'createdBy');
    const plan = await this.currentPlan(tenantId, campaignId, executionPlanId);
    const normalized = this.normalize(input);
    const now = new Date().toISOString();
    const contentHash = this.hash(normalized);
    const draft: UnversionedCreativePackageV1 = {
      creativePackageId: randomUUID(),
      tenantId,
      campaignId,
      sourceExecutionPlanId: plan.executionPlanId,
      sourcePlanHash: plan.planHash,
      schemaVersion: '1.0',
      status: 'needs_review',
      ...normalized,
      validationIssues: this.validationIssues(normalized),
      contentHash,
      createdAt: now,
    };
    const creativePackage = await this.packages.appendNext(
      draft,
      this.event(draft, actor, 'creative_package_version_created', {
        contentHash,
        status: 'needs_review',
        validationIssues: draft.validationIssues,
      }, now),
    );
    if (!creativePackage) throw new NotFoundException('Campaign not found');
    const derived = await this.persistDerivedPlan(plan, creativePackage);
    return { creativePackage, executionPlan: derived };
  }

  async approve(
    tenantId: unknown,
    campaignId: unknown,
    version: unknown,
    contentHash: unknown,
    approvedBy: unknown,
  ): Promise<{ creativePackage: CreativePackageV1; executionPlan: ExecutionPlanV1 }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    if (!Number.isInteger(version) || (version as number) < 1) {
      throw new BadRequestException('version must be a positive integer');
    }
    if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) {
      throw new BadRequestException('contentHash must be a SHA-256 hex digest');
    }
    const actor = this.assertActor(approvedBy, 'approvedBy');
    const candidate = await this.packages.findVersion(
      tenantId, campaignId, version as number,
    );
    if (!candidate) throw new NotFoundException('Creative package not found');
    const latest = await this.packages.latest(tenantId, campaignId);
    if (!latest || latest.version !== candidate.version
      || latest.contentHash !== candidate.contentHash) {
      throw new ConflictException({
        code: 'creative_package_not_current',
        message: 'Only the latest creative package version can be approved',
      });
    }
    if (candidate.contentHash !== contentHash) {
      throw new ConflictException({
        code: 'creative_content_hash_mismatch',
        message: 'Approval must reference the exact creative content hash',
      });
    }
    if (candidate.validationIssues.length > 0
      || !Object.values(candidate.reviewChecklist).every(Boolean)) {
      throw new ConflictException({
        code: 'creative_package_not_ready',
        message: 'All content checks must pass before approval',
        blockers: candidate.validationIssues,
      });
    }
    if (candidate.status === 'approved') {
      const current = await this.plans.latest(tenantId, campaignId);
      if (!current) throw new NotFoundException('Execution plan not found');
      const alreadyBound = current.objectsToCreate.some((object) =>
        object.type === 'creative'
        && object.logicalConfig.copyStatus === 'approved'
        && object.logicalConfig.creativePackageId === candidate.creativePackageId
        && object.logicalConfig.creativePackageVersion === candidate.version
        && object.logicalConfig.creativeContentHash === candidate.contentHash);
      return {
        creativePackage: candidate,
        executionPlan: alreadyBound
          ? current
          : await this.persistDerivedPlan(current, candidate),
      };
    }
    const now = new Date().toISOString();
    const creativePackage = await this.packages.approveLatest(
      tenantId,
      campaignId,
      candidate.version,
      candidate.contentHash,
      actor,
      now,
      this.event(candidate, actor, 'creative_package_approved', {
        status: 'approved',
        contentHash: candidate.contentHash,
      }, now),
    );
    if (!creativePackage) {
      throw new ConflictException({
        code: 'creative_package_changed',
        message: 'The creative package changed before approval was persisted',
      });
    }
    const plan = await this.plans.latest(tenantId, campaignId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    const derived = await this.persistDerivedPlan(plan, creativePackage);
    return { creativePackage, executionPlan: derived };
  }

  async latest(tenantId: unknown, campaignId: unknown): Promise<CreativePackageV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const result = await this.packages.latest(tenantId, campaignId);
    if (!result) throw new NotFoundException('Creative package not found');
    return result;
  }

  private async persistDerivedPlan(
    source: ExecutionPlanV1,
    creativePackage: CreativePackageV1,
  ): Promise<ExecutionPlanV1> {
    const approved = creativePackage.status === 'approved';
    const creativeRef = {
      creativePackageId: creativePackage.creativePackageId,
      creativePackageVersion: creativePackage.version,
      creativeContentHash: creativePackage.contentHash,
    };
    const objectsToCreate = this.bindCreativeVariants(
      source,
      creativePackage,
      creativeRef,
      approved,
    );
    const readiness = source.readiness.map((check) => check.key === 'creative_approval'
      ? approved ? {
        key: 'creative_approval',
        status: 'passed' as const,
        meaning: 'O pacote criativo versionado foi revisado e aprovado pelo hash exato.',
        evidenceRefs: [
          `creative_package:${creativePackage.creativePackageId}`,
          `creative_content_hash:${creativePackage.contentHash}`,
        ],
        source: 'user_confirmation' as const,
      } : {
        key: 'creative_approval',
        status: 'pending' as const,
        meaning: 'A versão criativa atual ainda exige revisão humana completa.',
        nextAction: 'Revisar checklist, fontes, textos e mídias e aprovar o hash atual.',
        evidenceRefs: [`creative_content_hash:${creativePackage.contentHash}`],
        source: 'system' as const,
      }
      : check);
    const risks = approved
      ? source.risks.filter((risk) => risk.code !== 'creative_content_not_approved')
      : [
        ...source.risks.filter((risk) => risk.code !== 'creative_content_not_approved'),
        {
          code: 'creative_content_not_approved',
          severity: 'high' as const,
          meaning: 'A versão atual do conteúdo criativo ainda não foi aprovada.',
          mitigation: 'Concluir os controles e aprovar o hash exato do pacote criativo.',
          blocksExecution: true,
        },
      ];
    const decisions = [
      ...source.decisions.filter((decision) => decision.category !== 'creative_safety'),
      {
        decisionId: 'creative_package_binding',
        category: 'creative_safety' as const,
        ruleId: 'versioned_source_only_creative_v1',
        inputRefs: [
          `creative_package:${creativePackage.creativePackageId}`,
          `creative_content_hash:${creativePackage.contentHash}`,
        ],
        outcome: { ...creativeRef, approvalStatus: creativePackage.status },
        rationale: approved
          ? 'Textos, mídias e alegações foram aprovados com checklist e fontes rastreáveis.'
          : 'Qualquer mudança criativa gera nova versão e mantém a execução bloqueada.',
      },
    ];
    const planHash = this.hash({
      purpose: 'creative_package_binding_v1',
      sourcePlanHash: source.planHash,
      creativeContentHash: creativePackage.contentHash,
      creativePackageVersion: creativePackage.version,
      approvalStatus: creativePackage.status,
    });
    const derived: ExecutionPlanV1 = {
      ...source,
      executionPlanId: randomUUID(),
      correlationId: randomUUID(),
      planHash,
      idempotencyKey: this.hash({
        purpose: 'creative_package_binding_idempotency_v1',
        tenantId: source.tenantId,
        campaignId: source.campaignId,
        sourcePlanHash: source.planHash,
        creativeContentHash: creativePackage.contentHash,
        creativePackageVersion: creativePackage.version,
        approvalStatus: creativePackage.status,
      }),
      status: 'draft',
      objectsToCreate,
      readiness,
      decisions,
      risks,
      autonomy: { level: 'A0', approvalRequired: true },
      externalEffects: { writesAllowed: false, writesPerformed: false },
      createdAt: new Date().toISOString(),
    };
    const persisted = await this.plans.saveIdempotent(derived);
    await this.approvals.invalidateForCampaignExceptHash(
      source.tenantId,
      source.campaignId,
      persisted.planHash,
      persisted.createdAt,
    );
    return persisted;
  }

  private bindCreativeVariants(
    source: ExecutionPlanV1,
    creativePackage: CreativePackageV1,
    creativeRef: {
      creativePackageId: string;
      creativePackageVersion: number;
      creativeContentHash: string;
    },
    approved: boolean,
  ): ExecutionPlanV1['objectsToCreate'] {
    const structural = source.objectsToCreate.filter(
      (object) => object.type !== 'creative' && object.type !== 'ad',
    );
    const adSet = structural.find((object) => object.type === 'ad_set');
    if (!adSet || creativePackage.copies.length !== creativePackage.assets.length) {
      return source.objectsToCreate.map((object) => object.type === 'creative' ? {
        ...object,
        logicalConfig: {
          ...creativeRef,
          copies: creativePackage.copies,
          claims: creativePackage.claims,
          assets: creativePackage.assets,
          reviewChecklist: creativePackage.reviewChecklist,
          copyStatus: approved ? 'approved' : 'requires_review',
          claimsPolicy: 'source_only',
        },
      } : object);
    }
    const variants = creativePackage.copies.map((copy, index) => {
      const asset = creativePackage.assets[index];
      const variantKey = `variant_${index + 1}`;
      const creativeId = `${source.campaignId}:creative:${variantKey}`;
      return [{
        internalObjectId: creativeId,
        type: 'creative' as const,
        dependsOn: [],
        logicalConfig: {
          ...creativeRef,
          variantKey,
          copy,
          asset,
          claims: creativePackage.claims,
          reviewChecklist: creativePackage.reviewChecklist,
          copyStatus: approved ? 'approved' : 'requires_review',
          claimsPolicy: 'source_only',
        },
      }, {
        internalObjectId: `${source.campaignId}:ad:${variantKey}`,
        type: 'ad' as const,
        dependsOn: [adSet.internalObjectId, creativeId],
        logicalConfig: {
          variantKey,
          creativeInternalObjectId: creativeId,
          lifecycleStatus: 'PAUSED',
        },
      }];
    }).flat();
    return [...structural, ...variants];
  }

  private normalize(input: CreativePackageInputV1 | undefined): Pick<
    CreativePackageV1, 'copies' | 'claims' | 'assets' | 'reviewChecklist'
  > {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('creative package input must be an object');
    }
    return {
      copies: this.copies(input.copies),
      claims: this.claims(input.claims),
      assets: this.assets(input.assets),
      reviewChecklist: this.checklist(input.reviewChecklist),
    };
  }

  private copies(value: unknown): CreativeCopyV1[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
      throw new BadRequestException('copies must contain between 1 and 10 items');
    }
    return value.map((raw, index) => {
      const item = this.record(raw, `copies[${index}]`);
      const callToAction = this.text(item.callToAction, `copies[${index}].callToAction`, 40);
      if (!CTAS.includes(callToAction as CreativeCallToAction)) {
        throw new BadRequestException(`copies[${index}].callToAction is not supported`);
      }
      const whatsappMessage = item.whatsappMessage === undefined
        ? undefined
        : this.text(item.whatsappMessage, `copies[${index}].whatsappMessage`, 1_000);
      if (callToAction === 'SEND_WHATSAPP_MESSAGE' && !whatsappMessage) {
        throw new BadRequestException(
          `copies[${index}].whatsappMessage is required for WhatsApp CTA`,
        );
      }
      return {
        copyId: this.identifier(item.copyId, `copies[${index}].copyId`),
        primaryText: this.text(item.primaryText, `copies[${index}].primaryText`, 2_200),
        headline: this.text(item.headline, `copies[${index}].headline`, 255),
        ...(item.description === undefined ? {} : {
          description: this.text(item.description, `copies[${index}].description`, 500),
        }),
        ...(whatsappMessage ? { whatsappMessage } : {}),
        callToAction: callToAction as CreativeCallToAction,
      };
    });
  }

  private claims(value: unknown): CreativeClaimV1[] {
    if (!Array.isArray(value) || value.length > 50) {
      throw new BadRequestException('claims must be an array with at most 50 items');
    }
    return value.map((raw, index) => {
      const item = this.record(raw, `claims[${index}]`);
      if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length < 1
        || item.sourceRefs.length > 20) {
        throw new BadRequestException(`claims[${index}].sourceRefs must not be empty`);
      }
      return {
        claimId: this.identifier(item.claimId, `claims[${index}].claimId`),
        text: this.text(item.text, `claims[${index}].text`, 1_000),
        sourceRefs: item.sourceRefs.map((ref, refIndex) =>
          this.text(ref, `claims[${index}].sourceRefs[${refIndex}]`, 500)),
      };
    });
  }

  private assets(value: unknown): CreativeAssetV1[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
      throw new BadRequestException('assets must contain between 1 and 20 items');
    }
    return value.map((raw, index) => {
      const item = this.record(raw, `assets[${index}]`);
      const mimeType = this.text(item.mimeType, `assets[${index}].mimeType`, 50);
      if (!MIME_TYPES.includes(mimeType as CreativeAssetV1['mimeType'])) {
        throw new BadRequestException(`assets[${index}].mimeType is not supported`);
      }
      return {
        assetId: this.identifier(item.assetId, `assets[${index}].assetId`),
        storageRef: this.text(item.storageRef, `assets[${index}].storageRef`, 1_000),
        sha256: this.sha256(item.sha256, `assets[${index}].sha256`),
        mimeType: mimeType as CreativeAssetV1['mimeType'],
        width: this.integer(item.width, `assets[${index}].width`, 1, 20_000),
        height: this.integer(item.height, `assets[${index}].height`, 1, 20_000),
      };
    });
  }

  private checklist(value: unknown): CreativeReviewChecklistV1 {
    const item = this.record(value, 'reviewChecklist');
    const fields: Array<keyof CreativeReviewChecklistV1> = [
      'claimsVerifiedAgainstSources', 'visualFidelityReviewed', 'safeAreaReviewed',
      'requiredFieldsReviewed', 'automaticEnhancementsReviewed',
    ];
    return Object.fromEntries(fields.map((field) => {
      if (typeof item[field] !== 'boolean') {
        throw new BadRequestException(`reviewChecklist.${field} must be a boolean`);
      }
      return [field, item[field]];
    })) as unknown as CreativeReviewChecklistV1;
  }

  private validationIssues(
    value: Pick<CreativePackageV1, 'copies' | 'claims' | 'assets' | 'reviewChecklist'>,
  ): string[] {
    const issues = Object.entries(value.reviewChecklist)
      .filter(([, passed]) => !passed)
      .map(([field]) => `review_check_pending:${field}`);
    const ids = [...value.copies.map((item) => item.copyId),
      ...value.claims.map((item) => item.claimId),
      ...value.assets.map((item) => item.assetId)];
    if (new Set(ids).size !== ids.length) issues.push('duplicate_item_identifier');
    if (value.copies.length !== value.assets.length) {
      issues.push('creative_variant_pairing_mismatch');
    }
    return issues;
  }

  private async currentPlan(
    tenantId: string,
    campaignId: string,
    executionPlanId: string,
  ): Promise<ExecutionPlanV1> {
    const [plan, latest] = await Promise.all([
      this.plans.findById(tenantId, executionPlanId),
      this.plans.latest(tenantId, campaignId),
    ]);
    if (!plan || plan.campaignId !== campaignId) {
      throw new NotFoundException('Execution plan not found');
    }
    if (!latest || latest.executionPlanId !== plan.executionPlanId
      || latest.planHash !== plan.planHash) {
      throw new ConflictException({
        code: 'execution_plan_not_current',
        message: 'Only the latest campaign plan can receive creative content',
      });
    }
    return plan;
  }

  private event(
    creativePackage: Pick<CreativePackageV1, 'creativePackageId' | 'tenantId'>,
    actorId: string,
    eventType: string,
    newState: unknown,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: creativePackage.tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId,
      eventType,
      objectType: 'creative_package',
      objectId: creativePackage.creativePackageId,
      newState,
      result: 'success',
      createdAt,
    };
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

  private identifier(value: unknown, field: string): string {
    const result = this.text(value, field, 100);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(result)) {
      throw new BadRequestException(`${field} contains unsupported characters`);
    }
    return result;
  }

  private sha256(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new BadRequestException(`${field} must be a SHA-256 hex digest`);
    }
    return value;
  }

  private integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return value as number;
  }

  private assertActor(value: unknown, field: string): string {
    return this.text(value, field, 200);
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
