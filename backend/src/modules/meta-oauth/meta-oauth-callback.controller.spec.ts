import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaOAuthCallbackController } from './meta-oauth-callback.controller';
import { MetaOAuthService } from './meta-oauth.service';

describe('MetaOAuthCallbackController', () => {
  const service = (callback: jest.Mock) => ({ callback } as unknown as MetaOAuthService);
  const config = (value: string) => ({ get: jest.fn().mockReturnValue(value) } as unknown as ConfigService);

  it('returns only to the server-owned frontend after a successful callback', async () => {
    const callback = jest.fn().mockResolvedValue({ status: 'connected', connectionId: '22222222-2222-4222-8222-222222222222' });
    const controller = new MetaOAuthCallbackController(service(callback), config('https://app.contexto.example'));

    const result = await controller.callback('state-1', 'code-1', undefined);

    expect(callback).toHaveBeenCalledWith({ state: 'state-1', code: 'code-1', error: undefined });
    expect(result.statusCode).toBe(303);
    const url = new URL(result.url);
    expect(url.origin).toBe('https://app.contexto.example');
    expect(url.pathname).toBe('/connections');
    expect(url.searchParams.get('oauth')).toBe('connected');
    expect(url.searchParams.get('connectionId')).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('allows localhost HTTP only for local central development', async () => {
    const callback = jest.fn().mockResolvedValue({ status: 'connected', connectionId: '22222222-2222-4222-8222-222222222222' });
    const controller = new MetaOAuthCallbackController(service(callback), config('http://localhost:3001'));
    const result = await controller.callback('state-1', 'code-1', undefined);
    expect(new URL(result.url).origin).toBe('http://localhost:3001');
  });

  it('fails closed for an unsafe or missing frontend destination', async () => {
    const callback = jest.fn().mockResolvedValue({ status: 'connected', connectionId: '22222222-2222-4222-8222-222222222222' });
    const controller = new MetaOAuthCallbackController(service(callback), config('http://attacker.example'));
    await expect(controller.callback('state-1', 'code-1', undefined))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
