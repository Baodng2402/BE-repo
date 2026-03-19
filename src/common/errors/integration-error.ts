import { HttpException, HttpStatus } from '@nestjs/common';
import { IntegrationProvider } from '../../entities';

export type IntegrationErrorCode =
  | 'ACCOUNT_NOT_LINKED'
  | 'TOKEN_EXPIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR';

export interface IntegrationErrorBody {
  code: IntegrationErrorCode;
  message: string;
  provider?: IntegrationProvider;
  retryable?: boolean;
  reconnectRequired?: boolean;
  details?: Record<string, unknown>;
}

export function createIntegrationException(
  status: HttpStatus,
  body: IntegrationErrorBody,
): HttpException {
  return new HttpException(
    {
      ...body,
      retryable: body.retryable ?? false,
      reconnectRequired: body.reconnectRequired ?? false,
    },
    status,
  );
}
