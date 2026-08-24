import { Pool, PoolClient } from 'pg';
import {
  CampaignContextPackageV1,
  UnversionedCampaignContextPackageV1,
} from '../../domain/contracts/campaign-context';
import { CampaignContextRepository } from '../../domain/ports/repositories';

interface CampaignContextRow {
  package_id: string;
  tenant_id: string;
  campaign_id: string;
  version: number;
  schema_version: '1.0';
  status: CampaignContextPackageV1['status'];
  facts: CampaignContextPackageV1['facts'];
  inferences: [];
  validation_issues: CampaignContextPackageV1['validationIssues'];
  content_hash: string;
  created_at: Date;
}

export class PostgresCampaignContextRepository implements CampaignContextRepository {
  constructor(private readonly pool: Pool) {}

  async create(context: CampaignContextPackageV1): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into campaigns (campaign_id, tenant_id, created_at)
        values ($1, $2, $3)`,
        [context.campaignId, context.tenantId, context.createdAt],
      );
      await this.insertVersion(client, context);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendNext(
    context: UnversionedCampaignContextPackageV1,
  ): Promise<CampaignContextPackageV1 | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const campaign = await client.query(
        `select campaign_id from campaigns
        where tenant_id = $1 and campaign_id = $2
        for update`,
        [context.tenantId, context.campaignId],
      );
      if (campaign.rowCount !== 1) {
        await client.query('rollback');
        return null;
      }
      const result = await client.query<{ next_version: number }>(
        `select coalesce(max(version), 0) + 1 as next_version
        from campaign_context_versions
        where tenant_id = $1 and campaign_id = $2`,
        [context.tenantId, context.campaignId],
      );
      const versioned = { ...context, version: result.rows[0].next_version };
      await this.insertVersion(client, versioned);
      await client.query('commit');
      return versioned;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async latest(
    tenantId: string,
    campaignId: string,
  ): Promise<CampaignContextPackageV1 | null> {
    const result = await this.pool.query<CampaignContextRow>(
      `select package_id, tenant_id, campaign_id, version, schema_version,
        status, facts, inferences, validation_issues, content_hash, created_at
      from campaign_context_versions
      where tenant_id = $1 and campaign_id = $2
      order by version desc
      limit 1`,
      [tenantId, campaignId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async findVersion(
    tenantId: string,
    campaignId: string,
    version: number,
  ): Promise<CampaignContextPackageV1 | null> {
    const result = await this.pool.query<CampaignContextRow>(
      `select package_id, tenant_id, campaign_id, version, schema_version,
        status, facts, inferences, validation_issues, content_hash, created_at
      from campaign_context_versions
      where tenant_id = $1 and campaign_id = $2 and version = $3
      limit 1`,
      [tenantId, campaignId, version],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  private async insertVersion(
    client: PoolClient,
    context: CampaignContextPackageV1,
  ): Promise<void> {
    await client.query(
      `insert into campaign_context_versions (
        package_id, tenant_id, campaign_id, version, schema_version,
        status, facts, inferences, validation_issues, content_hash, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        context.packageId,
        context.tenantId,
        context.campaignId,
        context.version,
        context.schemaVersion,
        context.status,
        JSON.stringify(context.facts),
        JSON.stringify(context.inferences),
        JSON.stringify(context.validationIssues),
        context.contentHash,
        context.createdAt,
      ],
    );
  }

  private toDomain(row: CampaignContextRow): CampaignContextPackageV1 {
    return {
      packageId: row.package_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      version: row.version,
      schemaVersion: row.schema_version,
      status: row.status,
      facts: row.facts,
      inferences: row.inferences,
      validationIssues: row.validation_issues,
      contentHash: row.content_hash,
      createdAt: row.created_at.toISOString(),
    };
  }
}
