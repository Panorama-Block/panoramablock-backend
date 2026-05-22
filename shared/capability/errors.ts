/**
 * Capability error taxonomy.
 *
 * Every capability code path that throws **must** throw a `CapabilityError`. Plain `Error` is
 * forbidden at the application layer of a capability — it loses the category/code that the FE
 * pattern-matches on.
 *
 * See ADR 002 + CONVENTIONS.md §6.
 */

import type { SerializedCapabilityError } from "./envelope.types";

// -------------------------------------------------------------------------------------------------
// Categories — closed set
// -------------------------------------------------------------------------------------------------

/**
 * High-level error category. The FE uses this (not `code`) to choose the UX response.
 *
 * - **VALIDATION** (400) — the request itself is malformed/illegal.
 * - **UNSUPPORTED_ROUTE** (404) — no provider supports this route/chain pair.
 * - **INSUFFICIENT_LIQUIDITY** (422) — the request is well-formed but the market can't fill it.
 * - **PROVIDER_FAILURE** (502) — an upstream provider returned an error or timed out.
 * - **RATE_LIMITED** (429) — caller or backend hit a rate cap; retry later.
 * - **UNAVAILABLE** (503) — all providers down/unhealthy; capability temporarily disabled.
 * - **INTERNAL** (500) — bug in the backend; the FE should treat this as "report to support".
 */
export enum ErrorCategory {
  VALIDATION = "VALIDATION",
  UNSUPPORTED_ROUTE = "UNSUPPORTED_ROUTE",
  INSUFFICIENT_LIQUIDITY = "INSUFFICIENT_LIQUIDITY",
  PROVIDER_FAILURE = "PROVIDER_FAILURE",
  RATE_LIMITED = "RATE_LIMITED",
  UNAVAILABLE = "UNAVAILABLE",
  INTERNAL = "INTERNAL",
}

/**
 * Map category → default HTTP status.
 */
export function categoryToHttpStatus(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.VALIDATION:
      return 400;
    case ErrorCategory.UNSUPPORTED_ROUTE:
      return 404;
    case ErrorCategory.RATE_LIMITED:
      return 429;
    case ErrorCategory.INSUFFICIENT_LIQUIDITY:
      return 422;
    case ErrorCategory.INTERNAL:
      return 500;
    case ErrorCategory.PROVIDER_FAILURE:
      return 502;
    case ErrorCategory.UNAVAILABLE:
      return 503;
  }
}

// -------------------------------------------------------------------------------------------------
// The class
// -------------------------------------------------------------------------------------------------

export interface CapabilityErrorInput {
  /** Code in the form `CAPABILITY_<CAP>_<TYPE>`. See CONVENTIONS.md §6. */
  code: string;
  category: ErrorCategory;
  message: string;
  provider?: string;
  details?: Record<string, unknown>;
  /** Override the default HTTP status for this category. Rare; useful for retry-after semantics. */
  httpStatus?: number;
  /** Wrapped underlying cause (e.g. an ethers error). Preserved for logs, not exposed over the wire. */
  cause?: unknown;
}

export class CapabilityError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly provider?: string;
  public readonly details?: Record<string, unknown>;
  public readonly httpStatus: number;
  public readonly cause?: unknown;

  constructor(input: CapabilityErrorInput) {
    super(input.message);
    this.name = "CapabilityError";
    this.code = input.code;
    this.category = input.category;
    this.provider = input.provider;
    this.details = input.details;
    this.httpStatus = input.httpStatus ?? categoryToHttpStatus(input.category);
    this.cause = input.cause;

    // Preserve the stack as if thrown from the call site, not from this constructor.
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, CapabilityError);
    }
  }

  /**
   * Serialise into the wire format embedded in `CapabilityResponse.error`.
   * `cause` is intentionally omitted from the wire format — keep upstream errors in logs only.
   */
  toSerialized(): SerializedCapabilityError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      ...(this.provider && { provider: this.provider }),
      ...(this.details && { details: this.details }),
      httpStatus: this.httpStatus,
    };
  }

  /**
   * Useful in tests / type guards. `error instanceof CapabilityError` fails across module
   * boundaries when multiple copies of the class exist; this is a structural check.
   */
  static is(error: unknown): error is CapabilityError {
    return (
      error instanceof CapabilityError ||
      (typeof error === "object" &&
        error !== null &&
        (error as { name?: string }).name === "CapabilityError" &&
        typeof (error as { code?: unknown }).code === "string" &&
        typeof (error as { category?: unknown }).category === "string")
    );
  }

  // -----------------------------------------------------------------------------------------------
  // Factory methods — preferred way to construct common errors
  // -----------------------------------------------------------------------------------------------

  /**
   * No provider supports the requested route. Use when `policy.rank` returns 0 candidates or
   * every candidate fails `supportsRoute`.
   */
  static unsupportedRoute(input: {
    capability: string;
    chainId: number;
    attempted: string[];
    fromAsset?: string;
    toAsset?: string;
  }): CapabilityError {
    return new CapabilityError({
      code: `CAPABILITY_${input.capability.toUpperCase()}_UNSUPPORTED_ROUTE`,
      category: ErrorCategory.UNSUPPORTED_ROUTE,
      message: `No provider supports ${input.capability} on chain ${input.chainId}${
        input.fromAsset && input.toAsset ? ` for ${input.fromAsset} → ${input.toAsset}` : ""
      }. Attempted: ${input.attempted.join(", ") || "(none)"}.`,
      details: {
        capability: input.capability,
        chainId: input.chainId,
        attempted: input.attempted,
        ...(input.fromAsset && { fromAsset: input.fromAsset }),
        ...(input.toAsset && { toAsset: input.toAsset }),
      },
    });
  }

  /**
   * All ranked providers were attempted and each failed. Carries the per-provider error list
   * so the FE / logs can diagnose without N round-trips.
   */
  static allProvidersFailed(input: {
    capability: string;
    attempts: Array<{ provider: string; error: string }>;
  }): CapabilityError {
    return new CapabilityError({
      code: `CAPABILITY_${input.capability.toUpperCase()}_ALL_PROVIDERS_FAILED`,
      category: ErrorCategory.UNAVAILABLE,
      message: `All ${input.capability} providers failed. Attempts: ${input.attempts
        .map((a) => `${a.provider}: ${a.error}`)
        .join(" | ")}`,
      details: {
        capability: input.capability,
        attempts: input.attempts,
      },
    });
  }

  /**
   * Capability isn't implemented (yet) for this chain/path. Used by stub adapters
   * (`BaseStakingProviderAdapter` etc.) and by the registry when no provider has `enabled: true`.
   */
  static unavailable(message: string, details?: Record<string, unknown>): CapabilityError {
    return new CapabilityError({
      code: "CAPABILITY_UNAVAILABLE",
      category: ErrorCategory.UNAVAILABLE,
      message,
      details,
    });
  }

  /**
   * Input validation failed (Zod, manual checks). The `details.errors` should carry a
   * structured list of field-level violations for the FE to render.
   */
  static validation(input: {
    capability?: string;
    message: string;
    errors?: unknown;
  }): CapabilityError {
    const cap = input.capability ?? "REQUEST";
    return new CapabilityError({
      code: `CAPABILITY_${cap.toUpperCase()}_VALIDATION_FAILED`,
      category: ErrorCategory.VALIDATION,
      message: input.message,
      details: input.errors ? { errors: input.errors } : undefined,
    });
  }

  /**
   * Wrap a provider-level failure. The original error goes to `cause` (logs only), not over wire.
   */
  static providerFailure(input: {
    capability: string;
    provider: string;
    message: string;
    cause?: unknown;
    details?: Record<string, unknown>;
  }): CapabilityError {
    return new CapabilityError({
      code: `CAPABILITY_${input.capability.toUpperCase()}_PROVIDER_FAILURE`,
      category: ErrorCategory.PROVIDER_FAILURE,
      message: input.message,
      provider: input.provider,
      details: input.details,
      cause: input.cause,
    });
  }

  /**
   * Rate-limit hit. `retryAfterMs` is optional; set it to drive a `Retry-After` header.
   */
  static rateLimited(input: {
    capability: string;
    provider?: string;
    retryAfterMs?: number;
  }): CapabilityError {
    return new CapabilityError({
      code: `CAPABILITY_${input.capability.toUpperCase()}_RATE_LIMITED`,
      category: ErrorCategory.RATE_LIMITED,
      message: `Rate limit hit on ${input.capability}${
        input.provider ? ` (provider: ${input.provider})` : ""
      }.`,
      provider: input.provider,
      details: input.retryAfterMs ? { retryAfterMs: input.retryAfterMs } : undefined,
    });
  }

  /**
   * Internal error — for unexpected bugs. Avoid in normal flow; this 500s the request and pages oncall.
   */
  static internal(message: string, cause?: unknown): CapabilityError {
    return new CapabilityError({
      code: "CAPABILITY_INTERNAL_ERROR",
      category: ErrorCategory.INTERNAL,
      message,
      cause,
    });
  }
}
