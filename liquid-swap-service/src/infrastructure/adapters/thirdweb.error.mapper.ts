/**
 * ThirdWeb Error Mapper
 *
 * Maps ThirdWeb Bridge API error codes to our internal SwapError codes.
 * Based on ThirdWeb's official error codes from:
 * https://github.com/thirdweb-dev/js/blob/main/packages/thirdweb/src/bridge/types/Errors.ts
 *
 * ThirdWeb ErrorCode types:
 * - INVALID_INPUT
 * - ROUTE_NOT_FOUND
 * - AMOUNT_TOO_LOW
 * - AMOUNT_TOO_HIGH
 * - INTERNAL_SERVER_ERROR
 * - UNKNOWN_ERROR
 */

import { AxiosError } from 'axios';
import { SwapError, SwapErrorCode } from '../../domain/entities/errors';

/**
 * ThirdWeb API Error Response structure
 */
interface ThirdwebApiErrorResponse {
  code?: string;
  message?: string;
  correlationId?: string;
  error?: string;
}

/**
 * ThirdWeb error codes as returned by the Bridge API
 */
type ThirdwebErrorCode =
  | 'INVALID_INPUT'
  | 'ROUTE_NOT_FOUND'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_TOO_HIGH'
  | 'INTERNAL_SERVER_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Mapping from ThirdWeb error codes to our SwapErrorCode
 */
const THIRDWEB_ERROR_MAP: Record<ThirdwebErrorCode, SwapErrorCode> = {
  INVALID_INPUT: SwapErrorCode.INVALID_REQUEST,
  ROUTE_NOT_FOUND: SwapErrorCode.NO_ROUTE_FOUND,
  AMOUNT_TOO_LOW: SwapErrorCode.AMOUNT_TOO_LOW,
  AMOUNT_TOO_HIGH: SwapErrorCode.AMOUNT_TOO_HIGH,
  INTERNAL_SERVER_ERROR: SwapErrorCode.PROVIDER_ERROR,
  UNKNOWN_ERROR: SwapErrorCode.UNKNOWN_ERROR,
};

/**
 * Human-readable messages for each ThirdWeb error code
 */
const THIRDWEB_ERROR_MESSAGES: Record<ThirdwebErrorCode, string> = {
  INVALID_INPUT: 'Invalid input parameters provided for the swap request.',
  ROUTE_NOT_FOUND: 'No route available for this token pair. Try a different amount or token.',
  AMOUNT_TOO_LOW: 'The amount is too low to cover network fees. Please increase the swap amount.',
  AMOUNT_TOO_HIGH: 'The amount exceeds the maximum allowed for this route. Please reduce the swap amount.',
  INTERNAL_SERVER_ERROR: 'ThirdWeb service is experiencing issues. Please try again later.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

/**
 * Maps HTTP status codes to SwapErrorCode when no specific error code is provided
 */
function mapHttpStatusToSwapError(status: number): SwapErrorCode {
  switch (status) {
    case 400:
      return SwapErrorCode.INVALID_REQUEST;
    case 401:
      return SwapErrorCode.UNAUTHORIZED;
    case 403:
      return SwapErrorCode.FORBIDDEN;
    case 404:
      return SwapErrorCode.NO_ROUTE_FOUND;
    case 429:
      return SwapErrorCode.RATE_LIMIT_EXCEEDED;
    case 500:
      return SwapErrorCode.PROVIDER_ERROR;
    case 502:
    case 503:
    case 504:
      return SwapErrorCode.SERVICE_UNAVAILABLE;
    default:
      return SwapErrorCode.UNKNOWN_ERROR;
  }
}

/**
 * Extract error details from axios error response
 */
function extractErrorDetails(error: AxiosError<ThirdwebApiErrorResponse>): {
  code?: string;
  message?: string;
  correlationId?: string;
  status?: number;
} {
  const responseData = error.response?.data;
  const status = error.response?.status;

  return {
    code: responseData?.code,
    message: responseData?.message || responseData?.error || error.message,
    correlationId: responseData?.correlationId,
    status,
  };
}

/**
 * Check if error is a network/timeout error
 */
function isNetworkError(error: AxiosError): boolean {
  return (
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ECONNRESET' ||
    error.message?.toLowerCase().includes('timeout') ||
    error.message?.toLowerCase().includes('network')
  );
}

/**
 * Check if error is a ThirdWeb API key / secret key epoch expiry error.
 * This happens when THIRDWEB_SECRET_KEY on the backend has expired.
 */
function isEpochExpiredError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('token expired') && lower.includes('epoch');
}

/**
 * Check if error is an invalid gas parameters error (EIP-1559)
 * This happens when maxFeePerGas < maxPriorityFeePerGas
 */
function isInvalidGasError(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('maxfeepergas cannot be less than maxpriorityfeepergas') ||
    lowerMessage.includes('max fee per gas less than max priority fee') ||
    lowerMessage.includes('maxfeepergas') && lowerMessage.includes('maxpriorityfeepergas') ||
    lowerMessage.includes('eip-1559') && lowerMessage.includes('fee')
  );
}

/**
 * Maps a ThirdWeb API error to our internal SwapError
 *
 * @param error - The error caught from ThirdWeb API call
 * @param operation - The operation being performed (for logging context)
 * @returns SwapError with appropriate code and message
 *
 * @example
 * ```typescript
 * try {
 *   const quote = await axios.get(`${BRIDGE_API}/sell/quote`, params);
 * } catch (error) {
 *   throw mapThirdwebError(error, 'getQuote');
 * }
 * ```
 */
export function mapThirdwebError(error: unknown, operation: string): SwapError {
  // Handle non-axios errors
  if (!(error instanceof Error)) {
    return new SwapError(
      SwapErrorCode.UNKNOWN_ERROR,
      `Unexpected error during ${operation}`,
      { originalError: error }
    );
  }

  // ThirdWeb API key / secret key expired — do not leak the raw epoch message
  if (isEpochExpiredError(error.message || '')) {
    console.error(`[ThirdwebErrorMapper] ⚠️ THIRDWEB_SECRET_KEY has expired. Renew it at https://thirdweb.com/dashboard/settings/api-keys`);
    return new SwapError(
      SwapErrorCode.SERVICE_UNAVAILABLE,
      'Quote service is temporarily unavailable. Please try again later.',
      { operation, hint: 'THIRDWEB_SECRET_KEY expired — renew at ThirdWeb dashboard' }
    );
  }

  // Check for invalid gas parameters error (can come from wallet/transaction validation)
  if (isInvalidGasError(error.message || '')) {
    return new SwapError(
      SwapErrorCode.INVALID_GAS_PARAMS,
      'The transaction has invalid gas parameters. The provider returned inconsistent EIP-1559 fees.',
      {
        operation,
        originalMessage: error.message,
        hint: 'maxFeePerGas must be >= maxPriorityFeePerGas',
      }
    );
  }

  // Handle axios errors
  const axiosError = error as AxiosError<ThirdwebApiErrorResponse>;

  // Check for network/timeout errors first
  if (isNetworkError(axiosError)) {
    return new SwapError(
      SwapErrorCode.TIMEOUT,
      `Network error during ${operation}: ${axiosError.message}`,
      {
        operation,
        errorCode: axiosError.code,
        originalMessage: axiosError.message,
      }
    );
  }

  // Extract error details from response
  const { code, message, correlationId, status } = extractErrorDetails(axiosError);

  // ThirdWeb API key expired — can also arrive via HTTP response body
  if (isEpochExpiredError(message || '')) {
    console.error(`[ThirdwebErrorMapper] ⚠️ THIRDWEB_SECRET_KEY has expired (HTTP ${status}). Renew it at https://thirdweb.com/dashboard/settings/api-keys`);
    return new SwapError(
      SwapErrorCode.SERVICE_UNAVAILABLE,
      'Quote service is temporarily unavailable. Please try again later.',
      { operation, httpStatus: status, hint: 'THIRDWEB_SECRET_KEY expired' }
    );
  }

  // Log for debugging
  console.error(`[ThirdwebErrorMapper] Error in ${operation}:`, {
    thirdwebCode: code,
    message,
    correlationId,
    httpStatus: status,
  });

  // Map ThirdWeb error code to our code
  let swapErrorCode: SwapErrorCode;
  let errorMessage: string;

  if (code && code in THIRDWEB_ERROR_MAP) {
    swapErrorCode = THIRDWEB_ERROR_MAP[code as ThirdwebErrorCode];
    errorMessage = THIRDWEB_ERROR_MESSAGES[code as ThirdwebErrorCode];
  } else if (status) {
    // Fallback to HTTP status code mapping
    swapErrorCode = mapHttpStatusToSwapError(status);
    errorMessage = message || `HTTP ${status} error during ${operation}`;
  } else {
    // Complete fallback
    swapErrorCode = SwapErrorCode.UNKNOWN_ERROR;
    errorMessage = message || `Unknown error during ${operation}`;
  }

  return new SwapError(
    swapErrorCode,
    errorMessage,
    {
      operation,
      thirdwebCode: code,
      correlationId,
      httpStatus: status,
      originalMessage: message,
    },
    status
  );
}

/**
 * Maps ThirdWeb Bridge.status errors
 */
export function mapThirdwebStatusError(error: unknown, transactionHash: string): SwapError {
  if (!(error instanceof Error)) {
    return new SwapError(
      SwapErrorCode.UNKNOWN_ERROR,
      'Unexpected error while checking transaction status',
      { transactionHash, originalError: error }
    );
  }

  const message = error.message?.toLowerCase() || '';

  // Check for specific status errors
  if (message.includes('not found') || message.includes('not_found')) {
    return new SwapError(
      SwapErrorCode.NO_ROUTE_FOUND,
      'Transaction not found. It may still be processing.',
      { transactionHash }
    );
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return new SwapError(
      SwapErrorCode.TIMEOUT,
      'Timeout while checking transaction status',
      { transactionHash }
    );
  }

  return new SwapError(
    SwapErrorCode.PROVIDER_ERROR,
    `Failed to check transaction status: ${error.message}`,
    { transactionHash, originalMessage: error.message }
  );
}

/**
 * Checks if an error is retryable
 */
export function isRetryableThirdwebError(error: SwapError): boolean {
  const retryableCodes: SwapErrorCode[] = [
    SwapErrorCode.TIMEOUT,
    SwapErrorCode.RATE_LIMIT_EXCEEDED,
    SwapErrorCode.SERVICE_UNAVAILABLE,
    SwapErrorCode.PROVIDER_ERROR,
  ];

  return retryableCodes.includes(error.code);
}

/**
 * Get suggested retry delay in milliseconds based on error type
 */
export function getRetryDelay(error: SwapError): number {
  switch (error.code) {
    case SwapErrorCode.RATE_LIMIT_EXCEEDED:
      // Respect Retry-After header if available, otherwise wait 60s
      return (error.details?.retryAfter as number) || 60000;
    case SwapErrorCode.TIMEOUT:
      return 5000; // 5s for timeout
    case SwapErrorCode.SERVICE_UNAVAILABLE:
      return 30000; // 30s for service unavailable
    case SwapErrorCode.PROVIDER_ERROR:
      return 10000; // 10s for provider errors
    default:
      return 0; // Don't retry other errors
  }
}
