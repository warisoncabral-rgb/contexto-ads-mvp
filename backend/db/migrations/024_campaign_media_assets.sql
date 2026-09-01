create table if not exists campaign_media_assets (
  media_id uuid primary key,
  tenant_id uuid not null references tenant_profiles(tenant_id) on delete cascade,
  source_file_id text not null,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'video/mp4')),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width > 0 and width <= 20000),
  height integer not null check (height > 0 and height <= 20000),
  byte_length bigint not null check (byte_length > 0 and byte_length <= 157286400),
  content bytea not null,
  public_token uuid not null unique,
  created_at timestamptz not null default now(),
  unique (tenant_id, sha256)
);

create index if not exists campaign_media_assets_tenant_created_idx
  on campaign_media_assets (tenant_id, created_at desc);
