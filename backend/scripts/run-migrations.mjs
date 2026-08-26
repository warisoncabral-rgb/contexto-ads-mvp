import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()

function requiredBootstrap() {
  const tenantId = process.env.BOOTSTRAP_TENANT_ID?.trim()
  const displayName = process.env.BOOTSTRAP_TENANT_DISPLAY_NAME?.trim()
  const subject = process.env.OPERATOR_BOOTSTRAP_SUBJECT?.trim()
  const supplied = [tenantId, displayName, subject].filter(Boolean).length
  if (supplied === 0) return null
  if (supplied !== 3) throw new Error('Bootstrap tenant configuration is incomplete')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('BOOTSTRAP_TENANT_ID must be a valid UUID')
  }
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error('BOOTSTRAP_TENANT_DISPLAY_NAME is invalid')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@-]{2,199}$/.test(subject)) {
    throw new Error('OPERATOR_BOOTSTRAP_SUBJECT is invalid')
  }
  return { tenantId, displayName, subject }
}

try {
  await client.query("select pg_advisory_lock(hashtext('contexto_ads_schema_migrations_v1'))")
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    )
  `)

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const applied = await client.query(
      'select checksum_sha256 from schema_migrations where version = $1',
      [file],
    )
    if (applied.rowCount) {
      if (applied.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Applied migration changed: ${file}`)
      }
      continue
    }
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into schema_migrations (version, checksum_sha256) values ($1, $2)',
        [file, checksum],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }

  const bootstrap = requiredBootstrap()
  if (bootstrap) {
    await client.query('begin')
    try {
      const now = new Date().toISOString()
      await client.query(
        `insert into tenant_profiles (tenant_id, display_name, status, created_at, updated_at)
         values ($1, $2, 'active', $3, $3)
         on conflict (tenant_id) do update set
           display_name = excluded.display_name, status = 'active', updated_at = excluded.updated_at`,
        [bootstrap.tenantId, bootstrap.displayName, now],
      )
      await client.query(
        `insert into operator_tenant_memberships
           (membership_id, operator_subject, tenant_id, role, status, created_at, revoked_at)
         values ($1, $2, $3, 'owner', 'active', $4, null)
         on conflict (operator_subject, tenant_id) do update set
           role = 'owner', status = 'active', revoked_at = null`,
        [randomUUID(), bootstrap.subject, bootstrap.tenantId, now],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
  console.log(`Database ready: ${files.length} migration files verified`)
} finally {
  await client.query("select pg_advisory_unlock(hashtext('contexto_ads_schema_migrations_v1'))").catch(() => undefined)
  client.release()
  await pool.end()
}
