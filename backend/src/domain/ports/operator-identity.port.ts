import { OperatorPrincipalV1 } from '../contracts/operator-access';

export class OperatorAuthenticationUnavailableError extends Error {
  constructor() {
    super('Operator authentication is not configured');
  }
}

export class InvalidOperatorCredentialsError extends Error {
  constructor() {
    super('Invalid operator credentials');
  }
}

export interface OperatorIdentityPort {
  isAvailable(): boolean;
  authenticate(authorizationHeader: string | undefined): Promise<OperatorPrincipalV1>;
}
