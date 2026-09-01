import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';

export interface PersistedCampaignMedia {
  assetId: string;
  storageRef: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png' | 'video/mp4';
  width: number;
  height: number;
  originalName: string;
  byteLength: number;
}

type ActionFileRef = {
  name: string;
  id: string;
  mime_type?: string;
  download_link: string;
};

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

@Injectable()
export class CampaignMediaService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  async ingestActionFiles(
    tenantId: string,
    rawFiles: unknown,
    assetIds: string[],
  ): Promise<PersistedCampaignMedia[]> {
    const files = this.actionFiles(rawFiles);
    if (files.length !== assetIds.length) {
      throw new BadRequestException({
        code: 'creative_file_pairing_mismatch',
        message: 'A quantidade de arquivos anexados não corresponde aos criativos selecionados.',
      });
    }
    let total = 0;
    const results: PersistedCampaignMedia[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const bytes = await this.download(files[index]);
      total += bytes.length;
      if (total > MAX_TOTAL_BYTES) {
        throw new BadRequestException({
          code: 'creative_files_too_large',
          message: 'Os arquivos criativos ultrapassam o limite total permitido.',
        });
      }
      results.push(await this.persist(tenantId, files[index], assetIds[index], bytes));
    }
    return results;
  }

  async readPublic(mediaId: string, token: string) {
    if (!this.uuid(mediaId) || !this.uuid(token)) throw new NotFoundException();
    const result = await this.pool.query(
      `select original_name, mime_type, byte_length, content
         from campaign_media_assets
        where media_id = $1 and public_token = $2`,
      [mediaId, token],
    );
    if (!result.rowCount) throw new NotFoundException();
    const row = result.rows[0];
    return {
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      byteLength: Number(row.byte_length),
      content: Buffer.from(row.content),
    };
  }

  private actionFiles(value: unknown): ActionFileRef[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
      throw new BadRequestException({
        code: 'creative_files_required',
        message: 'Anexe os arquivos criativos escolhidos à conversa antes de concluir a campanha.',
      });
    }
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException({
          code: 'action_file_payload_unresolved',
          message: 'O ChatGPT não disponibilizou o arquivo anexado para processamento. Reanexe o arquivo e tente novamente.',
        });
      }
      const item = raw as Record<string, unknown>;
      const name = this.text(item.name, `openaiFileIdRefs[${index}].name`, 500);
      const id = this.text(item.id, `openaiFileIdRefs[${index}].id`, 500);
      const downloadLink = this.text(
        item.download_link,
        `openaiFileIdRefs[${index}].download_link`,
        4_000,
      );
      return {
        name,
        id,
        ...(typeof item.mime_type === 'string' ? { mime_type: item.mime_type } : {}),
        download_link: downloadLink,
      };
    });
  }

  private async download(file: ActionFileRef): Promise<Buffer> {
    let url = new URL(file.download_link);
    for (let hop = 0; hop < 4; hop += 1) {
      this.assertOpenAiDownloadUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: '*/*' },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new ConflictException('Creative file redirect is invalid');
          url = new URL(location, url);
          continue;
        }
        if (!response.ok || !response.body) {
          throw new ConflictException({
            code: 'creative_file_download_failed',
            message: 'Não foi possível baixar um dos arquivos criativos anexados.',
          });
        }
        const declared = Number(response.headers.get('content-length') ?? '0');
        if (declared > MAX_FILE_BYTES) throw new BadRequestException('Creative file is too large');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_FILE_BYTES) {
            controller.abort();
            throw new BadRequestException('Creative file is too large');
          }
          chunks.push(value);
        }
        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new ConflictException('Too many creative file redirects');
  }

  private async persist(
    tenantId: string,
    file: ActionFileRef,
    assetId: string,
    bytes: Buffer,
  ): Promise<PersistedCampaignMedia> {
    const mimeType = this.detectMime(bytes, file.mime_type);
    const dimensions = this.dimensions(bytes, mimeType);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.pool.query(
      `select media_id, public_token, original_name, mime_type, sha256, width, height, byte_length
         from campaign_media_assets where tenant_id = $1 and sha256 = $2`,
      [tenantId, sha256],
    );
    const row = existing.rowCount
      ? existing.rows[0]
      : (await this.insert(tenantId, file, mimeType, sha256, dimensions, bytes));
    return {
      assetId,
      storageRef: this.publicUrl(String(row.media_id), String(row.public_token)),
      sha256: String(row.sha256),
      mimeType: String(row.mime_type) as PersistedCampaignMedia['mimeType'],
      width: Number(row.width),
      height: Number(row.height),
      originalName: String(row.original_name),
      byteLength: Number(row.byte_length),
    };
  }

  private async insert(
    tenantId: string,
    file: ActionFileRef,
    mimeType: PersistedCampaignMedia['mimeType'],
    sha256: string,
    dimensions: { width: number; height: number },
    bytes: Buffer,
  ) {
    const mediaId = randomUUID();
    const publicToken = randomUUID();
    try {
      const result = await this.pool.query(
        `insert into campaign_media_assets
          (media_id, tenant_id, source_file_id, original_name, mime_type, sha256,
           width, height, byte_length, content, public_token, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         returning media_id, public_token, original_name, mime_type, sha256, width, height, byte_length`,
        [
          mediaId,
          tenantId,
          file.id,
          file.name,
          mimeType,
          sha256,
          dimensions.width,
          dimensions.height,
          bytes.length,
          bytes,
          publicToken,
        ],
      );
      return result.rows[0];
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== '23505') throw error;
      const existing = await this.pool.query(
        `select media_id, public_token, original_name, mime_type, sha256, width, height, byte_length
           from campaign_media_assets where tenant_id = $1 and sha256 = $2`,
        [tenantId, sha256],
      );
      if (!existing.rowCount) throw error;
      return existing.rows[0];
    }
  }

  private detectMime(bytes: Buffer, hint?: string): PersistedCampaignMedia['mimeType'] {
    if (bytes.length >= 24
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'image/png';
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
    if (hint && ['image/png', 'image/jpeg', 'video/mp4'].includes(hint)) {
      throw new BadRequestException('Creative file content does not match its MIME type');
    }
    throw new BadRequestException({
      code: 'creative_file_type_unsupported',
      message: 'O formato do arquivo criativo não é compatível. Use PNG, JPEG ou MP4.',
    });
  }

  private dimensions(
    bytes: Buffer,
    mimeType: PersistedCampaignMedia['mimeType'],
  ): { width: number; height: number } {
    if (mimeType === 'image/png') {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      return this.validDimensions(width, height);
    }
    if (mimeType === 'image/jpeg') return this.jpegDimensions(bytes);
    return this.mp4Dimensions(bytes);
  }

  private jpegDimensions(bytes: Buffer) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      const sof = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (sof && length >= 7) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return this.validDimensions(width, height);
      }
      offset += length;
    }
    throw new BadRequestException('JPEG dimensions could not be resolved');
  }

  private mp4Dimensions(bytes: Buffer) {
    const candidates: Array<{ width: number; height: number }> = [];
    for (let offset = 0; offset + 92 <= bytes.length; offset += 1) {
      if (bytes.toString('ascii', offset + 4, offset + 8) !== 'tkhd') continue;
      const size = bytes.readUInt32BE(offset);
      if (size < 92 || offset + size > bytes.length) continue;
      const version = bytes[offset + 8];
      const widthOffset = offset + (version === 1 ? 96 : 84);
      if (widthOffset + 8 > offset + size || widthOffset + 8 > bytes.length) continue;
      const width = bytes.readUInt32BE(widthOffset) / 65536;
      const height = bytes.readUInt32BE(widthOffset + 4) / 65536;
      if (width > 0 && height > 0) candidates.push({
        width: Math.round(width),
        height: Math.round(height),
      });
    }
    if (!candidates.length) throw new BadRequestException('MP4 dimensions could not be resolved');
    candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    return this.validDimensions(candidates[0].width, candidates[0].height);
  }

  private validDimensions(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 20_000 || height > 20_000) {
      throw new BadRequestException('Creative dimensions are invalid');
    }
    return { width, height };
  }

  private publicUrl(mediaId: string, token: string): string {
    const configured = this.config.get<string>('CONTEXT_ADS_API_PUBLIC_BASE_URL')?.trim();
    const base = configured || 'https://contexto-ads-validation-api.onrender.com';
    return `${base.replace(/\/$/, '')}/v1/public/media/${mediaId}/${token}`;
  }

  private assertOpenAiDownloadUrl(url: URL) {
    if (url.protocol !== 'https:') throw new BadRequestException('Creative file URL must use HTTPS');
    const host = url.hostname.toLowerCase();
    const allowed = host === 'openai.com'
      || host.endsWith('.openai.com')
      || host === 'oaiusercontent.com'
      || host.endsWith('.oaiusercontent.com')
      || host === 'openaiusercontent.com'
      || host.endsWith('.openaiusercontent.com');
    if (!allowed) throw new BadRequestException('Creative file URL host is not allowed');
  }

  private text(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a non-empty string up to ${max} characters`);
    }
    return value.trim();
  }

  private uuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
