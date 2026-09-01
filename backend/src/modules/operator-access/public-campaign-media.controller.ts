import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { CampaignMediaService } from './campaign-media.service';

@Controller('public/media')
export class PublicCampaignMediaController {
  constructor(private readonly media: CampaignMediaService) {}

  @Get(':mediaId/:token')
  async read(
    @Param('mediaId') mediaId: string,
    @Param('token') token: string,
    @Headers('range') range: string | undefined,
    @Res() response: any,
  ) {
    const asset = await this.media.readPublic(mediaId, token);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Disposition', `inline; filename="${this.safeName(asset.originalName)}"`);

    const parsed = this.range(range, asset.byteLength);
    if (!parsed) {
      response.status(200);
      response.setHeader('Content-Length', asset.byteLength);
      response.end(asset.content);
      return;
    }
    const { start, end } = parsed;
    response.status(206);
    response.setHeader('Content-Range', `bytes ${start}-${end}/${asset.byteLength}`);
    response.setHeader('Content-Length', end - start + 1);
    response.end(asset.content.subarray(start, end + 1));
  }

  private range(value: string | undefined, length: number) {
    if (!value) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match) return null;
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : length - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      if (Number.isInteger(suffix) && suffix > 0) {
        start = Math.max(0, length - suffix);
        end = length - 1;
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || start >= length) return null;
    return { start, end: Math.min(end, length - 1) };
  }

  private safeName(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'creative';
  }
}
