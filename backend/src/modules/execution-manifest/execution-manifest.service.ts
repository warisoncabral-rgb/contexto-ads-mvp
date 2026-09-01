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
  ExecutionManifestOperationV1,
  ExecutionManifestV1,
} from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ExecutionManifestRepository,
  ExecutionPlanRepository,
  ExecutionSimulationRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_MANIFEST_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  EXECUTION_SIMULATION_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { OperationalReadinessService } from '../operational-readiness/operational-readiness.service';

@Injectable()
export class ExecutionManifestService {
  constructor(
    private readonly readiness: OperationalReadinessService,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(EXECUTION_SIMULATION_REPOSITORY)
    private readonly simulations: ExecutionSimulationRepository,
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
  ) {}

  async prepare(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    approvalId?: unknown,
  ): Promise<ExecutionManifestV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    if (approvalId !== undefined) this.assertUuid(approvalId, 'approvalId');

    const plan = await this.currentPlan(tenantId, campaignId, executionPlanId);
    this.assertExecutableCreativeMedia(plan);
    const decision = await this.readiness.generate(
      tenantId, campaignId, executionPlanId, approvalId,
    );
    if (decision.status !== 'ready_for_executor_validation') {
      throw new ConflictException({
        message: 'Execution manifest cannot be prepared while readiness is blocked',
        readinessDecisionId: decision.readinessDecisionId,
        status: decision.status,
        nextAction: decision.nextAction,
      });
    }
    if (decision.planHash !== plan.planHash) {
      throw new ConflictException('Operational readiness is stale for the current plan');
    }
    const simulation = await this.simulations.findById(
      tenantId, executionPlanId, decision.simulationId,
    );
    if (!simulation
      || simulation.campaignId !== campaignId
      || simulation.planHash !== plan.planHash
      || simulation.status !== 'ready_for_execution') {
      throw new ConflictException('Ready simulation evidence is missing or stale');
    }

    const operations = this.operations(plan, simulation.operations);
    const executionGate: ExecutionManifestV1['executionGate'] = {
      status: 'closed',
      reason: 'write_path_not_validated_or_enabled',
      requirements: [
        {
          key: 'fresh_operational_readiness',
          status: 'satisfied',
          evidenceRefs: [
            `operational_readiness:${decision.readinessDecisionId}`,
            `plan_hash:${plan.planHash}`,
          ],
        },
        {
          key: 'specific_execution_approval',
          status: 'missing',
          evidenceRefs: [],
        },
        {
          key: 'real_meta_write_validation',
          status: 'missing',
          evidenceRefs: [],
        },
        {
          key: 'write_adapter_enabled',
          status: 'missing',
          evidenceRefs: [],
        },
        {
          key: 'kill_switch_validated',
          status: 'requires_execution_time_validation',
          evidenceRefs: [],
        },
      ],
    };
    const reconciliationPolicy: ExecutionManifestV1['reconciliationPolicy'] = {
      sourceOfTruth: 'meta_observed_state_with_internal_execution_record',
      unknownOutcome: 'stop_and_reconcile',
      retry: 'forbidden_until_previous_outcome_is_known',
      successEvidenceRequired: ['external_object_id', 'meta_response', 'observed_state'],
      automaticCorrection: 'only_when_safe_and_explicitly_authorized',
    };
    const boundaries: ExecutionManifestV1['boundaries'] = {
      executable: false,
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    };
    const semantic = {
      purpose: 'execution_manifest_v1',
      tenantId,
      campaignId,
      executionPlanId,
      readinessDecisionId: decision.readinessDecisionId,
      simulationId: simulation.simulationId,
      planHash: plan.planHash,
      status: 'prepared_gate_closed',
      operations,
      executionGate,
      reconciliationPolicy,
      boundaries,
    };
    const generatedAt = new Date().toISOString();
    const manifest: ExecutionManifestV1 = {
      executionManifestId: randomUUID(),
      tenantId,
      campaignId,
      executionPlanId,
      readinessDecisionId: decision.readinessDecisionId,
      simulationId: simulation.simulationId,
      planHash: plan.planHash,
      manifestHash: this.hash(semantic),
      status: 'prepared_gate_closed',
      operations,
      executionGate,
      reconciliationPolicy,
      boundaries,
      generatedAt,
    };
    return this.manifests.saveIdempotent(
      manifest,
      this.event(manifest, plan.correlationId, generatedAt),
    );
  }

  async latest(
    tenantId: unknown,
    executionPlanId: unknown,
  ): Promise<ExecutionManifestV1 | null> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    return this.manifests.latestForPlan(tenantId, executionPlanId);
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
    if (!latest
      || latest.executionPlanId !== executionPlanId
      || latest.planHash !== plan.planHash) {
      throw new ConflictException('Only the current execution plan can be prepared');
    }
    return plan;
  }

  private assertExecutableCreativeMedia(plan: ExecutionPlanV1): void {
    const creatives = plan.objectsToCreate.filter((object) => object.type === 'creative');
    for (const creative of creatives) {
      const asset = creative.logicalConfig.asset;
      const storageRef = asset && typeof asset === 'object' && !Array.isArray(asset)
        ? (asset as Record<string, unknown>).storageRef
        : undefined;
      if (typeof storageRef !== 'string' || !storageRef.trim()) {
        throw new ConflictException({
          code: 'creative_media_not_executable',
          message: 'O arquivo do criativo não está disponível para a criação segura na Meta.',
          nextAction: 'Anexe novamente o arquivo criativo aprovado. Nada será criado na Meta até o arquivo estar disponível.',
        });
      }
      try {
        const url = new URL(storageRef);
        if (url.protocol !== 'https:') throw new Error('not_https');
      } catch {
        throw new ConflictException({
          code: 'creative_media_not_executable',
          message: 'O arquivo do criativo não está disponível para a criação segura na Meta.',
          nextAction: 'Anexe novamente o arquivo criativo aprovado. Nada será criado na Meta até o arquivo estar disponível.',
        });
      }
    }
  }

  private operations(
    plan: ExecutionPlanV1,
    simulated: Array<{
      order: number;
      internalObjectId: string;
      objectType: ExecutionManifestOperationV1['objectType'];
      action: ExecutionManifestOperationV1['action'];
      dependsOn: string[];
      intendedLifecycleStatus: 'PAUSED';
      willExecute: false;
    }>,
  ): ExecutionManifestOperationV1[] {
    const configs = new Map(plan.objectsToCreate.map((object) => [
      object.internalObjectId, object.logicalConfig,
    ]));
    const keys = new Map(simulated.map((operation) => [
      operation.internalObjectId,
      this.hash({
        purpose: 'external_operation_v1',
        planHash: plan.planHash,
        internalObjectId: operation.internalObjectId,
        action: operation.action,
      }),
    ]));
    return [...simulated]
      .sort((left, right) => left.order - right.order)
      .map((operation) => {
        const operationKey = keys.get(operation.internalObjectId);
        const logicalConfig = configs.get(operation.internalObjectId);
        if (!operationKey || !logicalConfig) {
          throw new ConflictException('Simulation does not match the current plan objects');
        }
        const dependencyKeys = operation.dependsOn.map((dependency) => keys.get(dependency));
        if (dependencyKeys.some((key) => !key)) {
          throw new ConflictException('Simulation dependency does not match the current plan');
        }
        return {
          order: operation.order,
          operationKey,
          idempotencyKey: this.hash({
            purpose: 'meta_write_idempotency_v1',
            tenantId: plan.tenantId,
            campaignId: plan.campaignId,
            planHash: plan.planHash,
            operationKey,
          }),
          requestFingerprint: this.hash({
            objectType: operation.objectType,
            action: operation.action,
            logicalConfig,
            intendedLifecycleStatus: 'PAUSED',
          }),
          internalObjectId: operation.internalObjectId,
          objectType: operation.objectType,
          action: operation.action,
          dependsOnOperationKeys: dependencyKeys as string[],
          intendedLifecycleStatus: 'PAUSED',
          effectState: 'not_started',
          executionAllowed: false,
          preconditions: [
            'plan_hash_current',
            'execution_approval_fresh',
            'meta_target_current',
            'write_capabilities_current',
            'creative_hash_current',
            'write_adapter_enabled',
            'kill_switch_open',
          ].map((key) => ({
            key: key as ExecutionManifestOperationV1['preconditions'][number]['key'],
            timing: 'revalidate_immediately_before_write' as const,
          })),
          recovery: {
            ambiguousOutcome: 'block_and_reconcile_before_retry',
            partialFailure: 'stop_dependents_and_preserve_evidence',
            compensation: 'manual_policy_required_before_any_external_change',
          },
        };
      });
  }

  private event(
    manifest: ExecutionManifestV1,
    correlationId: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: manifest.tenantId,
      correlationId,
      actorType: 'system',
      eventType: 'execution_manifest_prepared',
      objectType: 'execution_manifest',
      objectId: manifest.executionManifestId,
      newState: {
        status: manifest.status,
        manifestHash: manifest.manifestHash,
        operationCount: manifest.operations.length,
        executionGate: 'closed',
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
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
