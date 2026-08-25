import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9:._@-]{2,199}$/;
const TOKEN = /^[A-Za-z0-9._~+\/=\-]{32,512}$/;

export class BootstrapOperatorIdentityAdapter implements OperatorIdentityPort {
  constructor(private readonly config: ConfigService) {}

  isAvailable(): boolean {
    return this.configuration() !== null;
  }

  async authenticate(authorizationHeader: string | undefined) {
    const configuration = this.configuration();
    if (!configuration) throw new OperatorAuthenticationUnavailableError();
    const token = this.bearerToken(authorizationHeader);
    const actual = createHash('sha256').update(token).digest();
    const expected = Buffer.from(configuration.tokenDigest, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new InvalidOperatorCredentialsError();
    }
    return {
      subject: configuration.subject,
      provider: 'bootstrap_token' as const,
      authenticatedAt: new Date().toISOString(),
    };
  }

  private configuration(): { subject: string; tokenDigest: string } | null {
    const subject = this.config.get<string>('OPERATOR_BOOTSTRAP_SUBJECT')?.trim();
    const configuredDigest = this.config
      .get<string>('OPERATOR_BOOTSTRAP_TOKEN_SHA256')?.trim().toLowerCase();
    const generatedToken = this.config.get<string>('OPERATOR_BOOTSTRAP_TOKEN')?.trim();
    const tokenDigest =
      configuredDigest && SHA256_HEX.test(configuredDigest)
        ? configuredDigest
        : generatedToken && TOKEN.test(generatedToken)
          ? createHash('sha256').update(generatedToken).digest('hex')
          : undefined;
    if (!subject || !SUBJECT.test(subject) || !tokenDigest || !SHA256_HEX.test(tokenDigest)) {
      return null;
    }
    return { subject, tokenDigest };
  }

  private bearerToken(header: string | undefined): string {
    if (typeof header !== 'string') throw new InvalidOperatorCredentialsError();
    const match = /^Bearer ([A-Za-z0-9._~+\/=\-]{32,512})$/.exec(header);
    if (!match) throw new InvalidOperatorCredentialsError();
    return match[1];
  }
}
