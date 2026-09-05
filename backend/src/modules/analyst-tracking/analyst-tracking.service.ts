import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import {
  AnalystTrackingRegistrationV1,
  AnalystTrackingSource,
} from '../../domain/contracts/analyst-tracking';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';
import { insertAuditEvent } from '../../infrastructure/database/postgres-audit.repository';

interface TrackingRow {
  registration_id: string;
  tenant_id: string;
  campaign_id: string;
  external_campaign_id: string;
  execution_plan_id: string;
  execution_manifest_id: string;
  meta_write_validation_protocol_id: string;
  source: AnalystTrackingSource;
  registered_at: Date;
  updated_at: Date;
}

@Injectable()
export class AnalystTrackingService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async ensureFromProtocol(
    protocol: MetaWriteValidationProtocolV1,
    actorId = 'system:generator-analyst-handoff',
  ): Promise<AnalystTrackingRegistrationV1 | null> {
    if (protocol.status !== 'external_validation_succeeded') return null;
    const resolved = this.externalCampaign(protocol);
    if (!resolved) return null;
    const now = new Date().toISOString();
    const draft = {
      registrationId: randomUUID(),
      tenantId: protocol.tenantId,
      campaignId: protocol.campaignId,
      externalCampaignId: resolved.externalCampaignId,
      executionPlanId: protocol.executionPlanId,
      executionManifestId: protocol.executionManifestId,
      metaWriteValidationProtocolId: protocol.metaWriteValidationProtocolId,
      source: resolved.source,
      registeredAt: now,
      updatedAt: now,
    };

    return this.inTransaction(async (client) => {
      const previous = await client.query<TrackingRow>(
        `select * from analyst_tracking_registrations
         where tenant_id = $1 and campaign_id = $2 limit 1`,
        [protocol.tenantId, protocol.campaignId],
      );
      const row = await client.query<TrackingRow>(
        `insert into analyst_tracking_registrations (
          registration_id, tenant_id, campaign_id, external_campaign_id,
          execution_plan_id, execution_manifest_id, meta_write_validation_protocol_id,
          source, registered_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (tenant_id, campaign_id) do update set
          external_campaign_id = excluded.external_campaign_id,
          execution_plan_id = excluded.execution_plan_id,
          execution_manifest_id = excluded.execution_manifest_id,
          meta_write_validation_protocol_id = excluded.meta_write_validation_protocol_id,
          source = excluded.source,
          updated_at = excluded.updated_at
        returning *`,
        [
          draft.registrationId,
          draft.tenantId,
          draft.campaignId,
          draft.externalCampaignId,
          draft.executionPlanId,
          draft.executionManifestId,
          draft.metaWriteValidationProtocolId,
          draft.source,
          draft.registeredAt,
          draft.updatedAt,
        ],
      );
      const saved = row.rows[0];
      const changed = !previous.rows[0]
        || previous.rows[0].external_campaign_id !== saved.external_campaign_id
        || previous.rows[0].meta_write_validation_protocol_id
          !== saved.meta_write_validation_protocol_id;
      if (changed) {
        await insertAuditEvent(client, this.event(saved, actorId, previous.rows[0] ?? null));
      }
      return this.map(saved);
    });
  }

  async find(tenantId: string, campaignId: string): Promise<AnalystTrackingRegistrationV1 | null> {
    const result = await this.pool.query<TrackingRow>(
      `select * from analyst_tracking_registrations
       where tenant_id = $1 and campaign_id = $2 limit 1`,
      [tenantId, campaignId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async findByExternalCampaignId(
    externalCampaignId: string,
  ): Promise<AnalystTrackingRegistrationV1 | null> {
    if (!/^\d+$/.test(externalCampaignId)) return null;
    const result = await this.pool.query<TrackingRow>(
      `select * from analyst_tracking_registrations
       where external_campaign_id = $1
       order by updated_at desc limit 1`,
      [externalCampaignId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  private externalCampaign(protocol: MetaWriteValidationProtocolV1): {
    externalCampaignId: string;
    source: AnalystTrackingSource;
  } | null {
    const executed = protocol.execution?.operations.find((operation) =>
      operation.objectType === 'campaign'
      && operation.status === 'succeeded'
      && typeof operation.externalObjectId === 'string'
      && /^\d+$/.test(operation.externalObjectId));
    if (executed?.externalObjectId) {
      return { externalCampaignId: executed.externalObjectId, source: 'execution_operation' };
    }
    const reconciled = protocol.reconciledOperations?.find((operation) =>
      operation.objectType === 'campaign'
      && typeof operation.externalObjectId === 'string'
      && /^\d+$/.test(operation.externalObjectId));
    return reconciled?.externalObjectId
      ? { externalCampaignId: reconciled.externalObjectId, source: 'reconciled_operation' }
      : null;
  }

  private map(row: TrackingRow): AnalystTrackingRegistrationV1 {
    return {
      registrationId: row.registration_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      externalCampaignId: row.external_campaign_id,
      executionPlanId: row.execution_plan_id,
      executionManifestId: row.execution_manifest_id,
      metaWriteValidationProtocolId: row.meta_write_validation_protocol_id,
      source: row.source,
      registeredAt: row.registered_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      boundaries: {
        trackingOnly: true,
        executionAuthorized: false,
        metaWritePerformed: false,
        externalWritesAllowed: false,
        recommendationAutoExecuted: false,
      },
    };
  }

  private event(row: TrackingRow, actorId: string, previous: TrackingRow | null): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: row.tenant_id,
      correlationId: row.campaign_id,
      actorType: 'system',
      actorId,
      eventType: 'analyst_tracking_registered',
      objectType: 'analyst_tracking_registration',
      objectId: row.registration_id,
      ...(previous ? {
        previousState: {
          externalCampaignId: previous.external_campaign_id,
          protocolId: previous.meta_write_validation_protocol_id,
        },
      } : {}),
      newState: {
        campaignId: row.campaign_id,
        externalCampaignId: row.external_campaign_id,
        protocolId: row.meta_write_validation_protocol_id,
        source: row.source,
        executionAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'success',
      createdAt: row.updated_at.toISOString(),
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
