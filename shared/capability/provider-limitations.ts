/**
 * Provider limitations — per-provider caps on amounts, blocked tokens/chains, daily volume.
 *
 * Today these live scattered inside adapter implementations (hard-coded `if (amount > MAX) throw`).
 * This module gives every provider a declarative way to surface its caps; the capability facade
 * (or a middleware) calls `applyLimitations` before delegating to the provider and converts a
 * violation into a `CapabilityError(VALIDATION)` with structured details.
 *
 * Card #208 (SPRINT_HUGO.md).
 */

import { CapabilityError } from "./errors";

// -------------------------------------------------------------------------------------------------
// The limitations shape — usually carried inside `ProviderMetadata.features` or via a separate
// adapter property; both work, this module doesn't impose a placement.
// -------------------------------------------------------------------------------------------------

export interface ProviderLimitations {
  /** Asset → max amount (wei as decimal string). Inclusive lower bound is `minAmountByAsset`. */
  maxAmountByAsset?: Record<string, string>;
  /** Asset → min amount (wei as decimal string). */
  minAmountByAsset?: Record<string, string>;
  /** Tokens (by symbol or address) that this provider refuses outright. */
  blockedTokens?: string[];
  /** Chains the provider declines to operate on (overrides `supportedChains` for runtime ops). */
  blockedChains?: number[];
  /** Hard cap on daily USD volume per tenant. Enforced by the caller; this module only reports. */
  dailyVolumeLimitUsd?: number;
  /** Free-form labels for ops (e.g. "kyc-required"). The capability code may inspect these. */
  flags?: string[];
}

// -------------------------------------------------------------------------------------------------
// Input handed to applyLimitations
// -------------------------------------------------------------------------------------------------

export interface LimitationCheckInput {
  capability: string;
  provider: string;
  limitations: ProviderLimitations;
  /** The asset being moved/affected — symbol or address; whatever the limitations are keyed by. */
  asset?: string;
  /** Amount in wei as decimal string. */
  amount?: string;
  chainId?: number;
  /** Cumulative USD volume the caller has already done today; provider checks against limit. */
  todayVolumeUsd?: number;
}

// -------------------------------------------------------------------------------------------------
// Result
// -------------------------------------------------------------------------------------------------

export type LimitationOk = { ok: true };
export type LimitationErr = { ok: false; error: CapabilityError };
export type LimitationResult = LimitationOk | LimitationErr;

// -------------------------------------------------------------------------------------------------
// Implementation
// -------------------------------------------------------------------------------------------------

/**
 * Run the registered limitation checks. Returns a tagged result rather than throwing so the
 * caller can choose to convert into HTTP error vs collect multiple violations.
 *
 * Violations are surfaced with the most specific category available:
 *  - blockedTokens / blockedChains / amount out of range → VALIDATION
 *  - dailyVolumeLimitUsd exceeded → RATE_LIMITED (the user can retry tomorrow)
 */
export function applyLimitations(input: LimitationCheckInput): LimitationResult {
  const { capability, provider, limitations, asset, amount, chainId, todayVolumeUsd } = input;

  if (asset && limitations.blockedTokens?.includes(asset)) {
    return {
      ok: false,
      error: CapabilityError.validation({
        capability,
        message: `Provider "${provider}" does not support asset "${asset}"`,
        errors: [{ field: "asset", reason: "blocked", value: asset }],
      }),
    };
  }

  if (typeof chainId === "number" && limitations.blockedChains?.includes(chainId)) {
    return {
      ok: false,
      error: CapabilityError.validation({
        capability,
        message: `Provider "${provider}" refuses operations on chain ${chainId}`,
        errors: [{ field: "chainId", reason: "blocked", value: chainId }],
      }),
    };
  }

  if (typeof amount === "string" && asset) {
    const max = limitations.maxAmountByAsset?.[asset];
    if (max && compareDecimalStrings(amount, max) > 0) {
      return {
        ok: false,
        error: CapabilityError.validation({
          capability,
          message: `Amount ${amount} for "${asset}" exceeds provider "${provider}" max ${max}`,
          errors: [{ field: "amount", reason: "above-max", value: amount, max }],
        }),
      };
    }
    const min = limitations.minAmountByAsset?.[asset];
    if (min && compareDecimalStrings(amount, min) < 0) {
      return {
        ok: false,
        error: CapabilityError.validation({
          capability,
          message: `Amount ${amount} for "${asset}" below provider "${provider}" min ${min}`,
          errors: [{ field: "amount", reason: "below-min", value: amount, min }],
        }),
      };
    }
  }

  if (
    typeof todayVolumeUsd === "number" &&
    typeof limitations.dailyVolumeLimitUsd === "number" &&
    todayVolumeUsd >= limitations.dailyVolumeLimitUsd
  ) {
    return {
      ok: false,
      error: CapabilityError.rateLimited({
        capability,
        provider,
      }),
    };
  }

  return { ok: true };
}

// -------------------------------------------------------------------------------------------------
// Decimal-string comparison (avoid BigInt to keep this module dep-free; amounts are wei as string)
// -------------------------------------------------------------------------------------------------

/**
 * Compare two non-negative decimal integer strings. Returns -1, 0, 1.
 * Throws if either string isn't a digits-only sequence (allows trimming + leading zeros).
 */
export function compareDecimalStrings(a: string, b: string): number {
  const aClean = stripLeadingZeros(a.trim());
  const bClean = stripLeadingZeros(b.trim());
  if (!/^\d+$/.test(aClean) || !/^\d+$/.test(bClean)) {
    throw new Error(
      `compareDecimalStrings: expected non-negative digits-only strings, got ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
    );
  }
  if (aClean.length !== bClean.length) return aClean.length - bClean.length > 0 ? 1 : -1;
  if (aClean === bClean) return 0;
  return aClean > bClean ? 1 : -1;
}

function stripLeadingZeros(s: string): string {
  const stripped = s.replace(/^0+/, "");
  return stripped.length === 0 ? "0" : stripped;
}
