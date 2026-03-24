import { SwapError, SwapErrorCode } from '../../domain/entities/errors';

export type UserFacingErrorCategory =
  | 'user-action'
  | 'temporary'
  | 'blocked'
  | 'unknown';

export interface UserFacingErrorPayload {
  success: false;
  error: {
    code: SwapErrorCode;
    category: UserFacingErrorCategory;
    title: string;
    description: string;
    actions: {
      primary: {
        type: 'retry';
        label: string;
        disabledUntil?: string;
      };
      secondary?: {
        type: 'support' | 'docs';
        label: string;
        href?: string;
      };
    };
    traceId: string;
    canRetry: boolean;
    retryAfterSeconds?: number;
  };
}

interface ErrorMappingConfig {
  category: UserFacingErrorCategory;
  title: string;
  description: string;
  secondaryAction?: {
    type: 'support' | 'docs';
    label: string;
    href?: string;
  };
}

const DEFAULT_PRIMARY_ACTION = {
  type: 'retry' as const,
  label: 'Try again',
};

const ERROR_MAPPINGS: Partial<Record<SwapErrorCode, ErrorMappingConfig>> = {
  [SwapErrorCode.MISSING_REQUIRED_PARAMS]: {
    category: 'user-action',
    title: 'Incomplete information',
    description:
      'Please fill in all required fields to continue.',
  },
  [SwapErrorCode.INVALID_REQUEST]: {
    category: 'user-action',
    title: 'Invalid request',
    description:
      'Some values appear to be in an unexpected format. Please review and try again.',
  },
  [SwapErrorCode.INVALID_AMOUNT]: {
    category: 'user-action',
    title: 'Invalid amount',
    description:
      'The amount could not be processed. Please adjust the value and try again.',
  },
  [SwapErrorCode.AMOUNT_TOO_LOW]: {
    category: 'user-action',
    title: 'Amount too low',
    description:
      'The amount is too low to cover network fees. Please increase the swap amount.',
  },
  [SwapErrorCode.AMOUNT_TOO_HIGH]: {
    category: 'user-action',
    title: 'Amount too high',
    description:
      'The amount exceeds the maximum allowed for this route. Please reduce the swap amount or try a different token pair.',
  },
  [SwapErrorCode.INVALID_TOKEN_ADDRESS]: {
    category: 'user-action',
    title: 'Unknown token',
    description:
      'We could not recognize this token. Please verify the address before proceeding.',
  },
  [SwapErrorCode.INVALID_CHAIN]: {
    category: 'user-action',
    title: 'Unsupported network',
    description:
      'Please select a network supported by Panorama Block to continue.',
  },
  [SwapErrorCode.UNSUPPORTED_CHAIN]: {
    category: 'user-action',
    title: 'Network not supported',
    description:
      'This network is not yet supported. Please choose another available option.',
  },
  [SwapErrorCode.UNSUPPORTED_TOKEN]: {
    category: 'user-action',
    title: 'Token not supported',
    description:
      'This asset is not yet on our list. Try another token or contact support.',
  },
  [SwapErrorCode.INSUFFICIENT_LIQUIDITY]: {
    category: 'user-action',
    title: 'Insufficient liquidity',
    description:
      'There is not enough liquidity to complete this swap right now. Try a smaller amount.',
  },
  [SwapErrorCode.NO_ROUTE_FOUND]: {
    category: 'user-action',
    title: 'Route unavailable',
    description:
      'No route was found for this token pair. Try a different pair or network.',
  },
  [SwapErrorCode.PRICE_IMPACT_TOO_HIGH]: {
    category: 'user-action',
    title: 'High price impact',
    description:
      'This swap would move the price significantly. Reduce the amount or wait for better conditions.',
  },
  [SwapErrorCode.SLIPPAGE_TOO_HIGH]: {
    category: 'temporary',
    title: 'Quote expired',
    description:
      'The price moved since your last quote and the transaction was blocked to protect your funds. Please try again for an updated price.',
  },
  [SwapErrorCode.APPROVAL_REQUIRED]: {
    category: 'user-action',
    title: 'Approval required',
    description:
      'You need to approve the token before completing the swap. Please approve and try again.',
  },
  [SwapErrorCode.INSUFFICIENT_BALANCE]: {
    category: 'user-action',
    title: 'Insufficient balance',
    description:
      'Your balance does not cover this operation. Please add funds or reduce the amount.',
  },
  [SwapErrorCode.INVALID_GAS_PARAMS]: {
    category: 'temporary',
    title: 'Invalid gas parameters',
    description:
      'The provider returned inconsistent gas parameters. Please try again or choose a different route.',
  },
  [SwapErrorCode.RATE_LIMIT_EXCEEDED]: {
    category: 'temporary',
    title: 'Too many requests',
    description:
      'We received too many requests in a short time. Please wait a moment before trying again.',
  },
  [SwapErrorCode.QUOTA_EXCEEDED]: {
    category: 'temporary',
    title: 'Usage limit reached',
    description:
      'You have reached the usage limit for now. Please wait and try again later.',
  },
  [SwapErrorCode.TIMEOUT]: {
    category: 'temporary',
    title: 'Request timed out',
    description:
      'The operation took too long to respond. Please try again. If the issue persists, contact support.',
  },
  [SwapErrorCode.RPC_ERROR]: {
    category: 'temporary',
    title: 'Network instability',
    description:
      'The network is temporarily unstable. Please try again.',
  },
  [SwapErrorCode.PROVIDER_ERROR]: {
    category: 'temporary',
    title: 'Provider error',
    description:
      'Our liquidity provider did not respond as expected. This usually resolves in a moment.',
  },
  [SwapErrorCode.CACHE_ERROR]: {
    category: 'temporary',
    title: 'Cache error',
    description:
      'Some cached data was refreshed and the request could not be completed. Please try again.',
  },
  [SwapErrorCode.DATABASE_ERROR]: {
    category: 'temporary',
    title: 'Temporary instability',
    description:
      'We are experiencing internal instability. Please try again in a few moments.',
  },
  [SwapErrorCode.UNAUTHORIZED]: {
    category: 'blocked',
    title: 'Session expired',
    description:
      'Please log in again to continue securely.',
    secondaryAction: {
      type: 'support',
      label: 'Contact support',
    },
  },
  [SwapErrorCode.FORBIDDEN]: {
    category: 'blocked',
    title: 'Access restricted',
    description:
      'This action is not available for your profile. Please contact support if you need assistance.',
    secondaryAction: {
      type: 'support',
      label: 'Contact support',
    },
  },
  [SwapErrorCode.SERVICE_UNAVAILABLE]: {
    category: 'blocked',
    title: 'Service temporarily unavailable',
    description:
      'We are undergoing maintenance or experiencing instability. Please try again shortly.',
  },
  [SwapErrorCode.MAINTENANCE]: {
    category: 'blocked',
    title: 'Under maintenance',
    description:
      'We will be back shortly. Thank you for your patience.',
    secondaryAction: {
      type: 'support',
      label: 'Check status',
      href: 'https://status.panoramablock.com',
    },
  },
};

export interface UserFacingErrorResult {
  status: number;
  payload: UserFacingErrorPayload;
  log: {
    traceId: string;
    code: SwapErrorCode;
    category: UserFacingErrorCategory;
    status: number;
    retryable: boolean;
  };
  error: SwapError;
}

export class UserFacingErrorMapper {
  public map(error: unknown, traceId: string): UserFacingErrorResult {
    const swapError = this.normalizeError(error);
    const status = swapError.httpStatus || 500;

    const mapping = ERROR_MAPPINGS[swapError.code];
    const inferredCategory =
      mapping?.category ||
      (swapError.isRetryable() ? 'temporary' : 'unknown');

    const category =
      inferredCategory === 'unknown' && status >= 400 && status < 500
        ? 'user-action'
        : inferredCategory;

    const retryAfterSeconds = this.resolveRetryAfterSeconds(swapError);
    const disabledUntil =
      retryAfterSeconds !== undefined
        ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString()
        : undefined;

    const payload: UserFacingErrorPayload = {
      success: false,
      error: {
        code: swapError.code,
        category,
        title:
          mapping?.title ||
          'Unexpected error',
        description:
          mapping?.description ||
          'Something unexpected happened. Please try again in a moment.',
        actions: {
          primary: {
            ...DEFAULT_PRIMARY_ACTION,
            disabledUntil,
          },
          ...(mapping?.secondaryAction
            ? { secondary: mapping.secondaryAction }
            : {}),
        },
        traceId,
        canRetry: true,
        retryAfterSeconds,
      },
    };

    return {
      status,
      payload,
      log: {
        traceId,
        code: swapError.code,
        category,
        status,
        retryable: swapError.isRetryable(),
      },
      error: swapError,
    };
  }

  private normalizeError(error: unknown): SwapError {
    if (error instanceof SwapError) {
      return error;
    }

    if (error instanceof Error) {
      return new SwapError(
        SwapErrorCode.UNKNOWN_ERROR,
        error.message || 'Unknown error',
        {
          originalError: {
            message: error.message,
            stack: error.stack,
          },
        }
      );
    }

    return new SwapError(
      SwapErrorCode.UNKNOWN_ERROR,
      'Unexpected non-error thrown',
      {
        originalError: error,
      }
    );
  }

  private resolveRetryAfterSeconds(error: SwapError): number | undefined {
    const detail = error.details || {};

    if (typeof detail.retryAfter === 'number') {
      return detail.retryAfter;
    }

    if (typeof detail.retryAfterSeconds === 'number') {
      return detail.retryAfterSeconds;
    }

    return undefined;
  }
}
