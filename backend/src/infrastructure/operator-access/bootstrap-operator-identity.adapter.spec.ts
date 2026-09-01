import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
} from '../../domain/ports/operator-identity.port';
import { BootstrapOperatorIdentityAdapter } from './bootstrap-operator-identity.adapter';

describe('BootstrapOperatorIdentityAdapter', () => {
  const token = 'operator-token-with-at-least-thirty-two-characters';
  const subject = 'operator:warison';

  function adapter(configuration: Record<string, string | undefined>) {
    return new BootstrapOperatorIdentityAdapter({
      get: jest.fn((key: string) => configuration[key]),
    } as unknown as ConfigService);
  }

  it('authenticates only the configured token digest without storing plaintext', async () => {
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
    });
    expect(identity.isAvailable()).toBe(true);
    await expect(identity.authenticate(`Bearer ${token}`)).resolves
      .toEqual(expect.objectContaining({
        subject,
        provider: 'bootstrap_token',
        authenticatedAt: expect.any(String),
      }));
  });

  it('authenticates a Render-generated raw token shared with the panel', async () => {
    const renderToken = 'B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk=';
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN: renderToken,
    });
    expect(identity.isAvailable()).toBe(true);
    await expect(identity.authenticate(`Bearer ${renderToken}`)).resolves
      .toEqual(expect.objectContaining({
        subject,
        provider: 'bootstrap_token',
        authenticatedAt: expect.any(String),
      }));
  });

  it('accepts an optional secondary digest without invalidating the primary credential', async () => {
    const secondaryToken = 'secondary-operator-token-with-at-least-thirty-two-characters';
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
      OPERATOR_BOOTSTRAP_TOKEN_SHA256_SECONDARY: createHash('sha256').update(secondaryToken).digest('hex'),
    });

    await expect(identity.authenticate(`Bearer ${token}`)).resolves
      .toEqual(expect.objectContaining({ subject }));
    await expect(identity.authenticate(`Bearer ${secondaryToken}`)).resolves
      .toEqual(expect.objectContaining({ subject }));
  });

  it('ignores a malformed secondary digest while preserving a valid primary credential', async () => {
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
      OPERATOR_BOOTSTRAP_TOKEN_SHA256_SECONDARY: 'not-a-digest',
    });
    expect(identity.isAvailable()).toBe(true);
    await expect(identity.authenticate(`Bearer ${token}`)).resolves
      .toEqual(expect.objectContaining({ subject }));
  });

  it('fails closed when subject or any usable credential is absent or malformed', async () => {
    for (const configuration of [
      {},
      { OPERATOR_BOOTSTRAP_SUBJECT: subject },
      { OPERATOR_BOOTSTRAP_SUBJECT: 'x', OPERATOR_BOOTSTRAP_TOKEN_SHA256: 'a'.repeat(64) },
      { OPERATOR_BOOTSTRAP_SUBJECT: subject, OPERATOR_BOOTSTRAP_TOKEN_SHA256: 'not-a-digest' },
    ]) {
      const identity = adapter(configuration);
      expect(identity.isAvailable()).toBe(false);
      await expect(identity.authenticate(`Bearer ${token}`))
        .rejects.toBeInstanceOf(OperatorAuthenticationUnavailableError);
    }
  });

  it('can operate with only a valid secondary digest during controlled recovery', async () => {
    const secondaryToken = 'secondary-only-operator-token-with-thirty-two-characters';
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN_SHA256_SECONDARY: createHash('sha256').update(secondaryToken).digest('hex'),
    });
    expect(identity.isAvailable()).toBe(true);
    await expect(identity.authenticate(`Bearer ${secondaryToken}`)).resolves
      .toEqual(expect.objectContaining({ subject }));
  });

  it('normalizes missing, malformed and incorrect credentials to one error', async () => {
    const identity = adapter({
      OPERATOR_BOOTSTRAP_SUBJECT: subject,
      OPERATOR_BOOTSTRAP_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
    });
    for (const header of [
      undefined,
      token,
      'Basic dXNlcjpwYXNz',
      'Bearer short',
      `Bearer ${'wrong-token-'.repeat(4)}`,
    ]) {
      await expect(identity.authenticate(header))
        .rejects.toBeInstanceOf(InvalidOperatorCredentialsError);
    }
  });
});
