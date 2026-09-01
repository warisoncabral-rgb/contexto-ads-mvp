import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignMediaService } from './campaign-media.service';

describe('CampaignMediaService', () => {
  const pool = { query: jest.fn() } as any;
  const config = new ConfigService({
    CONTEXT_ADS_API_PUBLIC_BASE_URL: 'https://api.example.test',
  });
  const service = new CampaignMediaService(pool, config);

  beforeEach(() => jest.clearAllMocks());

  it('resolves PNG dimensions without user metadata', () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
    bytes.writeUInt32BE(864, 16);
    bytes.writeUInt32BE(1821, 20);
    expect((service as any).detectMime(bytes)).toBe('image/png');
    expect((service as any).dimensions(bytes, 'image/png')).toEqual({ width: 864, height: 1821 });
  });

  it('resolves MP4 track dimensions automatically', () => {
    const bytes = Buffer.alloc(120);
    bytes.writeUInt32BE(104, 0);
    bytes.write('tkhd', 4, 'ascii');
    bytes[8] = 0;
    bytes.writeUInt32BE(512 * 65536, 84);
    bytes.writeUInt32BE(910 * 65536, 88);
    expect((service as any).mp4Dimensions(bytes)).toEqual({ width: 512, height: 910 });
  });

  it('rejects unresolved GPT Action file refs instead of asking for technical IDs', () => {
    expect(() => (service as any).actionFiles(['file_123'])).toThrow(BadRequestException);
  });

  it('accepts the GPT Action runtime file object with download_link', () => {
    expect((service as any).actionFiles([{
      name: 'video.mp4',
      id: 'file_123',
      mime_type: 'video/mp4',
      download_link: 'https://files.oaiusercontent.com/file-test',
    }])).toEqual([{
      name: 'video.mp4',
      id: 'file_123',
      mime_type: 'video/mp4',
      download_link: 'https://files.oaiusercontent.com/file-test',
    }]);
  });
});
