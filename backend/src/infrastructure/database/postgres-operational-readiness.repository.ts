import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { OperationalReadinessDecisionV1 } from '../../domain/contracts/operational-readiness';
import { OperationalReadinessRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface OperationalReadinessRow {
  payload: OperationalReadinessDecisionV1;
}

export class PostgresOperationalReadinessRepository
implements OperationalReadinessRepository {
  constructor(private readonly pool: Pool) {}

  async saveIdempotent(
    decision: OperationalReadinessDecisionV1,
    event: AuditEvent,
  ): Promise<OperationalReadinessDecisionV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<OperationalReadinessRow>(
        `insert into operational_readiness_decisions (
          readiness_decision_id, tenant_id, campaign_id, execution_plan_id,
          plan_hash, simulation_id, decision_hash, status, payload, generated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        on conflict (tenant_id, campaign_id, execution_plan_id, decision_hash)
        do nothing returning payload`,
        [decision.readinessDecisionId, decision.tenantId, decision.campaignId,
          decision.executionPlanId, decision.planHash, decision.simulationId,
          decision.decisionHash, decision.status, JSON.stringify(decision),
          decision.generatedAt],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<OperationalReadinessRow>(
        `select payload from operational_readiness_decisions
        where tenant_id = $1 and campaign_id = $2 and execution_plan_id = $3
          and decision_hash = $4 limit 1`,
        [decision.tenantId, decision.campaignId, decision.executionPlanId,
          decision.decisionHash],
      )).rows[0];
      if (!result) throw new Error('Operational readiness idempotency invariant failed');
      return result.payload;
    });
  }

  async latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<OperationalReadinessDecisionV1 | null> {
    const result = await this.pool.query<OperationalReadinessRow>(
      `select payload from operational_readiness_decisions
      where tenant_id = $1 and execution_plan_id = $2
      order by generated_at desc, readiness_decision_id desc limit 1`,
      [tenantId, executionPlanId],
    );
    return result.rows[0]?.payload ?? null;
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
