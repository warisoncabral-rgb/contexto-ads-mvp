import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  KillSwitchScope,
  KillSwitchStateV1,
  UnversionedKillSwitchStateV1,
} from '../../domain/contracts/kill-switch';
import { KillSwitchRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface KillSwitchRow {
  kill_switch_state_id: string;
  tenant_id: string;
  scope: KillSwitchScope;
  campaign_id: string | null;
  version: number;
  status: KillSwitchStateV1['status'];
  reason: string;
  changed_by: string;
  correlation_id: string;
  changed_at: Date;
}

const COLUMNS = `kill_switch_state_id, tenant_id, scope, campaign_id,
  version, status, reason, changed_by, correlation_id, changed_at`;

export class PostgresKillSwitchRepository implements KillSwitchRepository {
  constructor(private readonly pool: Pool) {}

  async appendNext(
    state: UnversionedKillSwitchStateV1,
    event: AuditEvent,
  ): Promise<KillSwitchStateV1> {
    return this.inTransaction(async (client) => {
      const target = state.campaignId ?? '00000000-0000-0000-0000-000000000000';
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${state.tenantId}:${state.scope}:${target}`],
      );
      const latest = await this.latestWithClient(
        client, state.tenantId, state.scope, state.campaignId,
      );
      if (latest?.status === state.status) return latest;
      const version = (latest?.version ?? 0) + 1;
      const inserted = await client.query<KillSwitchRow>(
        `insert into kill_switch_states (
          kill_switch_state_id, tenant_id, scope, campaign_id, version,
          status, reason, changed_by, correlation_id, changed_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${COLUMNS}`,
        [state.killSwitchStateId, state.tenantId, state.scope,
          state.campaignId ?? null, version, state.status, state.reason,
          state.changedBy, state.correlationId, state.changedAt],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('Kill Switch insertion invariant failed');
      await insertAuditEvent(client, {
        ...event,
        previousState: latest ? {
          stateId: latest.killSwitchStateId,
          version: latest.version,
          status: latest.status,
        } : { status: 'missing' },
        newState: {
          stateId: state.killSwitchStateId,
          version,
          status: state.status,
          reason: state.reason,
          externalWritesAllowed: false,
        },
      });
      return this.toDomain(row);
    });
  }

  async latest(
    tenantId: string,
    scope: KillSwitchScope,
    campaignId?: string,
  ): Promise<KillSwitchStateV1 | null> {
    const result = await this.pool.query<KillSwitchRow>(
      `select ${COLUMNS} from kill_switch_states
      where tenant_id = $1 and scope = $2
        and campaign_id is not distinct from $3::uuid
      order by version desc limit 1`,
      [tenantId, scope, campaignId ?? null],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  private async latestWithClient(
    client: PoolClient,
    tenantId: string,
    scope: KillSwitchScope,
    campaignId?: string,
  ): Promise<KillSwitchStateV1 | null> {
    const result = await client.query<KillSwitchRow>(
      `select ${COLUMNS} from kill_switch_states
      where tenant_id = $1 and scope = $2
        and campaign_id is not distinct from $3::uuid
      order by version desc limit 1`,
      [tenantId, scope, campaignId ?? null],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  private toDomain(row: KillSwitchRow): KillSwitchStateV1 {
    return {
      killSwitchStateId: row.kill_switch_state_id,
      tenantId: row.tenant_id,
      scope: row.scope,
      ...(row.campaign_id ? { campaignId: row.campaign_id } : {}),
      version: row.version,
      status: row.status,
      reason: row.reason,
      changedBy: row.changed_by,
      correlationId: row.correlation_id,
      changedAt: row.changed_at.toISOString(),
    };
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
