import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { ExecutionPlanRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface ExecutionPlanRow {
  payload: ExecutionPlanV1;
}

export class PostgresExecutionPlanRepository implements ExecutionPlanRepository {
  constructor(private readonly pool: Pool) {}

  async saveIdempotent(
    plan: ExecutionPlanV1,
    event?: AuditEvent,
  ): Promise<ExecutionPlanV1> {
    if (!event) return this.persist(this.pool, plan);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { persisted, inserted } = await this.persistWithResult(client, plan);
      if (inserted) {
        await insertAuditEvent(client, { ...event, objectId: persisted.executionPlanId });
      }
      await client.query('commit');
      return persisted;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persist(
    database: Pick<Pool | PoolClient, 'query'>,
    plan: ExecutionPlanV1,
  ): Promise<ExecutionPlanV1> {
    return (await this.persistWithResult(database, plan)).persisted;
  }

  private async persistWithResult(
    database: Pick<Pool | PoolClient, 'query'>,
    plan: ExecutionPlanV1,
  ): Promise<{ persisted: ExecutionPlanV1; inserted: boolean }> {
    const insert = await database.query(
      `insert into execution_plans (
        execution_plan_id, tenant_id, campaign_id, campaign_package_version,
        plan_version, plan_hash, idempotency_key, status, payload, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      on conflict do nothing
      returning execution_plan_id`,
      [
        plan.executionPlanId,
        plan.tenantId,
        plan.campaignId,
        plan.campaignPackageVersion,
        plan.planVersion,
        plan.planHash,
        plan.idempotencyKey,
        plan.status,
        JSON.stringify(plan),
        plan.createdAt,
      ],
    );
    const result = await database.query<ExecutionPlanRow>(
      `select payload from execution_plans
      where idempotency_key = $1 and tenant_id = $2 and campaign_id = $3`,
      [plan.idempotencyKey, plan.tenantId, plan.campaignId],
    );
    if (!result.rows[0]) {
      throw new Error('Execution plan idempotency invariant failed');
    }
    return { persisted: result.rows[0].payload, inserted: insert.rowCount === 1 };
  }

  async latest(tenantId: string, campaignId: string): Promise<ExecutionPlanV1 | null> {
    const result = await this.pool.query<ExecutionPlanRow>(
      `select payload from execution_plans
      where tenant_id = $1 and campaign_id = $2
      order by created_at desc, execution_plan_id desc
      limit 1`,
      [tenantId, campaignId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async findById(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionPlanV1 | null> {
    const result = await this.pool.query<ExecutionPlanRow>(
      `select payload from execution_plans
      where tenant_id = $1 and execution_plan_id = $2
      limit 1`,
      [tenantId, executionPlanId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async listLatestForTenant(tenantId: string): Promise<ExecutionPlanV1[]> {
    const result = await this.pool.query<ExecutionPlanRow>(
      `select distinct on (campaign_id) payload
      from execution_plans
      where tenant_id = $1
      order by campaign_id, created_at desc, execution_plan_id desc`,
      [tenantId],
    );
    return result.rows
      .map((row) => row.payload)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
