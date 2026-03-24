/**
 * Standardized error codes for the lending service.
 * These codes are sent in JSON responses and consumed by the frontend errorMapper.
 */

const ERROR_CODES = Object.freeze({
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',

  // Balance / amounts
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_COLLATERAL: 'INSUFFICIENT_COLLATERAL',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
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

  // Validation contract
  TAX_TRANSFER_FAILED: 'TAX_TRANSFER_FAILED',
  NO_AVAX_SENT: 'NO_AVAX_SENT',

  // Lending specific
  HEALTH_FACTOR_TOO_LOW: 'HEALTH_FACTOR_TOO_LOW',
  MARKET_NOT_FOUND: 'MARKET_NOT_FOUND',
  BORROW_CAP_REACHED: 'BORROW_CAP_REACHED',
});

/**
 * Create a standardized error response object.
 *
 * @param {number} status - HTTP status code
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {object} [details] - Optional additional details
 * @returns {{ success: false, error: { code: string, message: string, details?: object } }}
 */
function errorResponse(status, code, message, details) {
  const body = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return { status, body };
}

/**
 * Send a standardized error response.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 */
function sendError(res, status, code, message, details) {
  const { body } = errorResponse(status, code, message, details);
  return res.status(status).json(body);
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

/**
 * Check if an error is an RPC/provider failure.
 */
function isRpcError(err) {
  const msg = String(err?.message || err || '');
  return RPC_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Send a standardized 503 response for RPC failures.
 * Use this in catch blocks where RPC calls may fail.
 */
function sendRpcUnavailable(res, err) {
  console.error('[RPC_UNAVAILABLE]', String(err?.message || err).slice(0, 200));
  return res.status(503).set({ 'Retry-After': '5' }).json({
    success: false,
    error: {
      code: ERROR_CODES.RPC_UNAVAILABLE,
      message: 'Blockchain node temporarily unavailable. Please retry.',
      retryAfter: 5,
    },
  });
}

module.exports = { ERROR_CODES, errorResponse, sendError, isRpcError, sendRpcUnavailable };
