import { Response } from 'express';

/**
 * Standardized error codes for the lido/staking service.
 * These codes are sent in JSON responses and consumed by the frontend errorMapper.
 */
export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',

  // Balance / amounts
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  AMOUNT_TOO_SMALL: 'AMOUNT_TOO_SMALL',
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',

  // Transaction
  GAS_ESTIMATION_FAILED: 'GAS_ESTIMATION_FAILED',
  TRANSACTION_REVERTED: 'TRANSACTION_REVERTED',
  NONCE_TOO_LOW: 'NONCE_TOO_LOW',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // Network
  RPC_ERROR: 'RPC_ERROR',
  RPC_UNAVAILABLE: 'RPC_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Send a standardized error response.
 */
export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  const body: Record<string, unknown> = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details) {
    (body.error as Record<string, unknown>).details = details;
  }
  res.status(status).json(body);
}

const RPC_ERROR_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /missing response/i,
  /could not detect network/i,
  /bad response/i,
  /server error/i,
  /rate.?limit/i,
  /too many requests/i,
  /circuit breaker/i,
  /NETWORK_ERROR/i,
  /SERVER_ERROR/i,
  /TIMEOUT/i,
];

export function isRpcError(err: Error): boolean {
  const msg = err.message || '';
  return RPC_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

export function sendRpcUnavailable(res: Response, err: Error): void {
  console.error('[RPC_UNAVAILABLE]', err.message?.slice(0, 200));
  res.status(503).set({ 'Retry-After': '5' }).json({
    success: false,
    error: {
      code: ERROR_CODES.RPC_UNAVAILABLE,
      message: 'Blockchain node temporarily unavailable. Please retry.',
      retryAfter: 5,
    },
  });
}
