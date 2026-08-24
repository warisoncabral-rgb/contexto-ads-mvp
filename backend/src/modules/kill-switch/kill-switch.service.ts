import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  EffectiveKillSwitchV1,
  KillSwitchScope,
  KillSwitchStateV1,
  KillSwitchStatus,
  UnversionedKillSwitchStateV1,
} from '../../domain/contracts/kill-switch';
import {
  CampaignContextRepository,
  KillSwitchRepository,
} from '../../domain/ports/repositories';
import {
  CAMPAIGN_CONTEXT_REPOSITORY,
  KILL_SWITCH_REPOSITORY,
} from '../../infrastructure/database/database.tokens';

@Injectable()
export class KillSwitchService {
  constructor(
    @Inject(KILL_SWITCH_REPOSITORY)
    private readonly states: KillSwitchRepository,
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly campaigns: CampaignContextRepository,
  ) {}

  async changeTenant(
    tenantId: unknown,
    status: unknown,
    changedBy: unknown,
    reason: unknown,
  ): Promise<KillSwitchStateV1> {
    this.assertUuid(tenantId, 'tenantId');
    return this.change(tenantId, 'tenant', undefined, status, changedBy, reason);
  }

  async changeCampaign(
    tenantId: unknown,
    campaignId: unknown,
    status: unknown,
    changedBy: unknown,
    reason: unknown,
  ): Promise<KillSwitchStateV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    await this.assertCampaign(tenantId, campaignId);
    return this.change(tenantId, 'campaign', campaignId, status, changedBy, reason);
  }

  async effective(
    tenantId: unknown,
    campaignId: unknown,
  ): Promise<EffectiveKillSwitchV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    await this.assertCampaign(tenantId, campaignId);
    const [tenant, campaign] = await Promise.all([
      this.states.latest(tenantId, 'tenant'),
      this.states.latest(tenantId, 'campaign', campaignId),
    ]);
    const missing = !tenant || !campaign;
    const engaged = tenant?.status === 'engaged' || campaign?.status === 'engaged';
    const decision: EffectiveKillSwitchV1['decision'] = missing
      ? 'blocked_missing_state'
      : engaged ? 'blocked_engaged' : 'released';
    return {
      tenantId,
      campaignId,
      writesBlocked: decision !== 'released',
      decision,
      tenant: this.effectiveScope(tenant),
      campaign: this.effectiveScope(campaign),
      boundaries: {
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async change(
    tenantId: string,
    scope: KillSwitchScope,
    campaignId: string | undefined,
    statusValue: unknown,
    actorValue: unknown,
    reasonValue: unknown,
  ): Promise<KillSwitchStateV1> {
    const status = this.assertStatus(statusValue);
    const changedBy = this.assertText(actorValue, 'changedBy', 2, 200);
    const reason = this.assertText(reasonValue, 'reason', 3, 1000);
    const changedAt = new Date().toISOString();
    const state: UnversionedKillSwitchStateV1 = {
      killSwitchStateId: randomUUID(), tenantId, scope,
      ...(campaignId ? { campaignId } : {}), status, reason, changedBy,
      correlationId: randomUUID(), changedAt,
    };
    return this.states.appendNext(
      state,
      this.event(state, changedAt),
    );
  }

  private effectiveScope(state: KillSwitchStateV1 | null) {
    return state ? {
      known: true as const,
      status: state.status,
      stateId: state.killSwitchStateId,
      version: state.version,
    } : {
      known: false as const,
      status: 'missing' as const,
    };
  }

  private async assertCampaign(tenantId: string, campaignId: string): Promise<void> {
    if (!await this.campaigns.latest(tenantId, campaignId)) {
      throw new NotFoundException('Campaign not found');
    }
  }

  private event(state: UnversionedKillSwitchStateV1, createdAt: string): AuditEvent {
    return {
      auditEventId: randomUUID(), tenantId: state.tenantId,
      correlationId: state.correlationId, actorType: 'user', actorId: state.changedBy,
      eventType: state.status === 'engaged'
        ? 'kill_switch_engaged' : 'kill_switch_released',
      objectType: 'kill_switch', objectId: state.killSwitchStateId,
      newState: {
        scope: state.scope, campaignId: state.campaignId,
        status: state.status, reason: state.reason,
        externalWritesAllowed: false,
      },
      result: state.status === 'engaged' ? 'blocked' : 'info',
      createdAt,
    };
  }

  private assertStatus(value: unknown): KillSwitchStatus {
    if (value !== 'engaged' && value !== 'released') {
      throw new BadRequestException('status must be engaged or released');
    }
    return value;
  }

  private assertText(
    value: unknown, field: string, minimum: number, maximum: number,
  ): string {
    if (typeof value !== 'string'
      || value.trim().length < minimum || value.trim().length > maximum) {
      throw new BadRequestException(
        `${field} must have between ${minimum} and ${maximum} characters`,
      );
    }
    return value.trim();
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
