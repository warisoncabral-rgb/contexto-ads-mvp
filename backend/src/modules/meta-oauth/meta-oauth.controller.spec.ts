import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';

describe('MetaOAuthController', () => {
  it('defaults to the server-defined read-only profile and ignores arbitrary scopes', async () => {
    const start = jest.fn().mockResolvedValue({ attemptId: 'attempt-1' });
    const controller = new MetaOAuthController({ start } as unknown as MetaOAuthService);
    const body = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      redirectUri: 'https://attacker.example/callback',
      scopes: ['ads_management'],
    };

    await controller.start(
      '22222222-2222-4222-8222-222222222222',
      body,
    );

    expect(start).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'read_only',
    );
  });

  it('forwards only the named controlled validation profile when explicitly selected', async () => {
    const start = jest.fn().mockResolvedValue({ attemptId: 'attempt-1' });
    const controller = new MetaOAuthController({ start } as unknown as MetaOAuthService);
    await controller.start('22222222-2222-4222-8222-222222222222', {
      tenantId: '11111111-1111-4111-8111-111111111111',
      scopeProfile: 'controlled_write_validation',
    });
    expect(start).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'controlled_write_validation',
    );
  });
});
