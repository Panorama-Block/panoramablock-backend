/**
 * Provider metadata + base provider interface.
 *
 * Every adapter implements `ICapabilityProvider` (extended by per-capability ports like
 * `ISwapProvider`, `IStakingProvider`) and declares itself via `metadata: ProviderMetadata`.
 *
 * The metadata is what the Registry, Policy, Health tracker, and Discovery endpoint introspect.
 *
 * See CONVENTIONS.md §5 (provider naming) and ADR 002 §"Five-layer pattern".
 */

import type { ChainId } from "./envelope.types";

// -------------------------------------------------------------------------------------------------
// Capability slug — the closed set
// -------------------------------------------------------------------------------------------------

/**
 * Canonical capability slugs. Adding one requires an ADR (see ADR 003).
 */
export const CAPABILITY_SLUGS = [
  "swap",
  "lending",
  "staking",
  "liquidity",
  "bridge",
  "automation",
  "auth",
  "agent",
] as const;

export type CapabilitySlug = (typeof CAPABILITY_SLUGS)[number];

export function isCapabilitySlug(value: unknown): value is CapabilitySlug {
  return typeof value === "string" && (CAPABILITY_SLUGS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------------
// Metadata that every provider declares
// -------------------------------------------------------------------------------------------------

export interface ProviderMetadata {
  /** Provider name — lowercase ASCII. See CONVENTIONS.md §5. */
  name: string;

  /** Which capability this provider serves. Must be one of the closed set. */
  capability: CapabilitySlug;

  /** Chains on which this provider can operate. The Registry uses this for `listByChain`. */
  supportedChains: ChainId[];

  /** Free-form feature tags (e.g. `['stETH', 'wstETH']`, `['cross-chain']`). */
  features?: string[];

  /** SemVer of the adapter implementation (not the upstream protocol). */
  version: string;

  /**
   * When `false`, the provider is built and registered but the Registry skips it on `listByChain`
   * unless explicitly opted in. Default `true`.
   *
   * Used by stub adapters (e.g. `BaseStakingProviderAdapter`) that ship structurally complete
   * but with `throw CapabilityError.unavailable(...)` on every method.
   */
  enabled?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Health probe shape
// -------------------------------------------------------------------------------------------------

/**
 * Result of `provider.healthCheck()`. Used by the `ProviderHealthTracker` (card #209) to filter
 * unhealthy providers out of `listByChain`.
 */
export interface ProviderHealth {
  healthy: boolean;
  /** Round-trip latency of the probe in ms. */
  latencyMs?: number;
  /** Human-readable reason if `healthy: false`. */
  reason?: string;
  /** When this probe was taken. */
  checkedAt: string; // ISO 8601
}

// -------------------------------------------------------------------------------------------------
// Base provider interface
// -------------------------------------------------------------------------------------------------

/**
 * The shape every provider in the system shares. Per-capability ports extend this with
 * domain-specific methods.
 *
 * **Subtype convention:** per-capability port name is `I<Cap>Provider`. Each lives in the owning
 * service's `domain/ports/<cap>.provider.port.ts` and is imported by adapters there.
 *
 * @example
 *   // in lido-service/src/domain/ports/staking.provider.port.ts
 *   export interface IStakingProvider extends ICapabilityProvider {
 *     getPosition(addr: string, chainId: ChainId): Promise<StakingPosition>;
 *     prepareStake(req: PrepareStakeRequest): Promise<Transaction[]>;
 *   }
 */
export interface ICapabilityProvider {
  /** Provider name. Must match `metadata.name`. */
  readonly name: string;

  /** Full declaration of what this provider is/does. */
  readonly metadata: ProviderMetadata;

  /**
   * Optional health probe. If absent, the provider is treated as always healthy.
   * Implementations should be lightweight — this is polled at ~30s intervals.
   */
  healthCheck?(): Promise<ProviderHealth>;
}

// -------------------------------------------------------------------------------------------------
// Metadata validation
// -------------------------------------------------------------------------------------------------

export interface ValidationOk {
  ok: true;
}
export interface ValidationErr {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationErr;

/**
 * Validate a `ProviderMetadata` object. Used by the Registry on `register()` and by the config
 * loader (`registry.loader.ts`, card #205) when populating from JSON.
 *
 * Returns a structured result rather than throwing so callers can aggregate errors when loading
 * many providers from config.
 */
export function validateProviderMetadata(m: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof m !== "object" || m === null) {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  const meta = m as Partial<ProviderMetadata>;

  if (typeof meta.name !== "string" || meta.name.length === 0) {
    errors.push("name must be a non-empty string");
  } else if (meta.name !== meta.name.toLowerCase()) {
    errors.push(`name must be lowercase (got "${meta.name}")`);
  } else if (!/^[a-z][a-z0-9-]*$/.test(meta.name)) {
    errors.push(`name must match /^[a-z][a-z0-9-]*$/ (got "${meta.name}")`);
  }

  if (typeof meta.capability !== "string" || !isCapabilitySlug(meta.capability)) {
    errors.push(
      `capability must be one of ${CAPABILITY_SLUGS.join("|")} (got ${JSON.stringify(meta.capability)})`
    );
  }

  if (!Array.isArray(meta.supportedChains)) {
    errors.push("supportedChains must be an array");
  } else {
    if (meta.supportedChains.length === 0) {
      errors.push("supportedChains must have at least one chain id");
    }
    const bad = meta.supportedChains.filter(
      (c) => !Number.isInteger(c) || (c as number) <= 0
    );
    if (bad.length > 0) {
      errors.push(`supportedChains contains non-positive-integer entries: ${JSON.stringify(bad)}`);
    }
  }

  if (typeof meta.version !== "string" || !/^\d+\.\d+\.\d+/.test(meta.version)) {
    errors.push(`version must be a SemVer-ish string (got ${JSON.stringify(meta.version)})`);
  }

  if (meta.features !== undefined) {
    if (!Array.isArray(meta.features) || meta.features.some((f) => typeof f !== "string")) {
      errors.push("features, when present, must be an array of strings");
    }
  }

  if (meta.enabled !== undefined && typeof meta.enabled !== "boolean") {
    errors.push("enabled, when present, must be boolean");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
