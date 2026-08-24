import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  CreativePackageV1,
  UnversionedCreativePackageV1,
} from '../../domain/contracts/creative-package';
import { CreativePackageRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface CreativePackageRow {
  creative_package_id: string;
  tenant_id: string;
  campaign_id: string;
  source_execution_plan_id: string;
  source_plan_hash: string;
  version: number;
  schema_version: '1.0';
  status: CreativePackageV1['status'];
  copies: CreativePackageV1['copies'];
  claims: CreativePackageV1['claims'];
  assets: CreativePackageV1['assets'];
  review_checklist: CreativePackageV1['reviewChecklist'];
  validation_issues: string[];
  content_hash: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

const COLUMNS = `creative_package_id, tenant_id, campaign_id,
  source_execution_plan_id, source_plan_hash, version, schema_version, status,
  copies, claims, assets, review_checklist, validation_issues, content_hash,
  approved_by, approved_at, created_at`;

export class PostgresCreativePackageRepository implements CreativePackageRepository {
  constructor(private readonly pool: Pool) {}

  async appendNext(
    creativePackage: UnversionedCreativePackageV1,
    event: AuditEvent,
  ): Promise<CreativePackageV1 | null> {
    return this.inTransaction(async (client) => {
      const campaign = await client.query(
        `select campaign_id from campaigns
        where tenant_id = $1 and campaign_id = $2 for update`,
        [creativePackage.tenantId, creativePackage.campaignId],
      );
      if (campaign.rowCount !== 1) return null;
      const existing = await client.query<CreativePackageRow>(
        `select ${COLUMNS} from creative_package_versions
        where tenant_id = $1 and campaign_id = $2
          and source_plan_hash = $3 and content_hash = $4 limit 1`,
        [creativePackage.tenantId, creativePackage.campaignId,
          creativePackage.sourcePlanHash, creativePackage.contentHash],
      );
      if (existing.rows[0]) return this.toDomain(existing.rows[0]);
      const next = await client.query<{ next_version: number }>(
        `select coalesce(max(version), 0) + 1 as next_version
        from creative_package_versions where tenant_id = $1 and campaign_id = $2`,
        [creativePackage.tenantId, creativePackage.campaignId],
      );
      await client.query(
        `update creative_package_versions set status = 'superseded'
        where tenant_id = $1 and campaign_id = $2 and status = 'approved'`,
        [creativePackage.tenantId, creativePackage.campaignId],
      );
      const versioned = { ...creativePackage, version: next.rows[0].next_version };
      const inserted = await client.query<CreativePackageRow>(
        `insert into creative_package_versions (
          creative_package_id, tenant_id, campaign_id, source_execution_plan_id,
          source_plan_hash, version, schema_version, status, copies, claims, assets,
          review_checklist, validation_issues, content_hash, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,
          $12::jsonb,$13::jsonb,$14,$15) returning ${COLUMNS}`,
        [versioned.creativePackageId, versioned.tenantId, versioned.campaignId,
          versioned.sourceExecutionPlanId, versioned.sourcePlanHash, versioned.version,
          versioned.schemaVersion, versioned.status, JSON.stringify(versioned.copies),
          JSON.stringify(versioned.claims), JSON.stringify(versioned.assets),
          JSON.stringify(versioned.reviewChecklist), JSON.stringify(versioned.validationIssues),
          versioned.contentHash, versioned.createdAt],
      );
      await insertAuditEvent(client, event);
      return this.toDomain(inserted.rows[0]);
    });
  }

  async latest(tenantId: string, campaignId: string): Promise<CreativePackageV1 | null> {
    const result = await this.pool.query<CreativePackageRow>(
      `select ${COLUMNS} from creative_package_versions
      where tenant_id = $1 and campaign_id = $2 order by version desc limit 1`,
      [tenantId, campaignId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async findVersion(
    tenantId: string,
    campaignId: string,
    version: number,
  ): Promise<CreativePackageV1 | null> {
    const result = await this.pool.query<CreativePackageRow>(
      `select ${COLUMNS} from creative_package_versions
      where tenant_id = $1 and campaign_id = $2 and version = $3 limit 1`,
      [tenantId, campaignId, version],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async approveLatest(
    tenantId: string,
    campaignId: string,
    version: number,
    contentHash: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<CreativePackageV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<CreativePackageRow>(
        `update creative_package_versions package set status = 'approved',
          approved_by = $5, approved_at = $6
        where tenant_id = $1 and campaign_id = $2 and version = $3
          and content_hash = $4 and status = 'needs_review'
          and version = (select max(current.version) from creative_package_versions current
            where current.tenant_id = package.tenant_id
              and current.campaign_id = package.campaign_id)
        returning ${COLUMNS}`,
        [tenantId, campaignId, version, contentHash, approvedBy, approvedAt],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
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

  private toDomain(row: CreativePackageRow): CreativePackageV1 {
    return {
      creativePackageId: row.creative_package_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      sourceExecutionPlanId: row.source_execution_plan_id,
      sourcePlanHash: row.source_plan_hash,
      version: row.version,
      schemaVersion: row.schema_version,
      status: row.status,
      copies: row.copies,
      claims: row.claims,
      assets: row.assets,
      reviewChecklist: row.review_checklist,
      validationIssues: row.validation_issues,
      contentHash: row.content_hash,
      ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
      ...(row.approved_at ? { approvedAt: row.approved_at.toISOString() } : {}),
      createdAt: row.created_at.toISOString(),
    };
  }
}
