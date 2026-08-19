import { MetaOAuthCallbackController } from './meta-oauth-callback.controller';
import { MetaOAuthService } from './meta-oauth.service';

describe('MetaOAuthCallbackController', () => {
  it('forwards only provider callback parameters without tenant or connection input', async () => {
    const callback = jest.fn().mockResolvedValue({ status: 'connected' });
    const controller = new MetaOAuthCallbackController({
      callback,
    } as unknown as MetaOAuthService);

    await controller.callback('state-1', 'code-1', undefined);

    expect(callback).toHaveBeenCalledWith({
      state: 'state-1',
      code: 'code-1',
      error: undefined,
    });
  });

  it('forwards a provider cancellation without inventing public error details', async () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const controller = new MetaOAuthCallbackController({
      callback,
    } as unknown as MetaOAuthService);

    await controller.callback('state-1', undefined, 'access_denied');

    expect(callback).toHaveBeenCalledWith({
      state: 'state-1',
      code: undefined,
      error: 'access_denied',
    });
  });
});
