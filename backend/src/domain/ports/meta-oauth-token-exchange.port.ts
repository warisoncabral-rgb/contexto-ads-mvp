export interface MetaOAuthToken {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface MetaOAuthTokenExchangePort {
  exchangeCode(code: string): Promise<MetaOAuthToken>;
}

export class MetaOAuthExchangeError extends Error {
  constructor(
    public readonly kind: 'configuration' | 'upstream',
    message: string,
  ) {
    super(message);
    this.name = 'MetaOAuthExchangeError';
  }
}
