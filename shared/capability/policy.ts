/**
 * Priority policy abstraction.
 *
 * A policy ranks providers for a given request context. The facade of each capability calls
 *
 *     const ranked = policy.rank(providers, requestContext);
 *
 * then iterates `ranked` in order. The default policy is `ChainAssetPriorityPolicy` (config-driven
 * by chain id), but the abstraction allows specialised policies (cost-aware, latency-aware,
 * tenant-pinned, etc.) without touching the facade.
 *
 * The fallback iteration (call `supportsRoute`, attempt action, catch, move on) lives in
 * `fallbackInvoke` below — extracted from the existing
 * `liquid-swap-service/.../provider-selector.service.ts:201-242`.
 */

import { CapabilityError, ErrorCategory } from "./errors";
import type { ICapabilityProvider } from "./provider.types";

// -------------------------------------------------------------------------------------------------
// Policy interface
// -------------------------------------------------------------------------------------------------

/**
 * A request context handed to the policy. Capabilities specialise this:
 *  - Swap context carries `fromAsset`, `toAsset`, `fromChainId`, `toChainId`.
 *  - Lending context carries `asset`, `chainId`, `action: 'supply' | 'borrow'`.
 * The policy uses a subset of the fields it needs and ignores the rest.
 */
export interface PolicyContext {
  chainId: number;
  /** Optional secondary chain — used by cross-chain capabilities (bridge). */
  destinationChainId?: number;
  /** Optional asset tag — used by asset-aware policies. */
  asset?: string;
  /** Free-form fields for specialised policies. */
  [k: string]: unknown;
}

export interface IPriorityPolicy {
  /**
   * Rank candidates for the given context. The returned array is a permutation of the input
   * (no provider added or removed). Providers not mentioned by the policy go last in stable order.
   */
  rank<TProvider extends ICapabilityProvider>(
    providers: readonly TProvider[],
    context: PolicyContext
  ): TProvider[];
}

// -------------------------------------------------------------------------------------------------
// ChainAssetPriorityPolicy — config-driven by chain (and optional asset prefix)
// -------------------------------------------------------------------------------------------------

/**
 * Config shape for `ChainAssetPriorityPolicy`. Either pass a flat per-chain priority map, or a
 * nested per-chain-per-asset map for finer control.
 *
 *     {
 *       "8453": ["aerodrome", "uniswap-trading-api", "uniswap", "thirdweb"],
 *       "1":    ["uniswap-trading-api", "uniswap", "thirdweb"],
 *       "default-cross-chain": ["thirdweb", "uniswap-trading-api", "uniswap"]
 *     }
 *
 * Or with asset-specific overrides:
 *
 *     {
 *       "8453": {
 *         "default": ["aerodrome", "uniswap"],
 *         "by-asset": { "USDC": ["uniswap", "aerodrome"] }
 *       }
 *     }
 */
export type PerChainList = string[];
export interface PerChainAssetMap {
  default: string[];
  "by-asset"?: Record<string, string[]>;
}
export type ChainPriorityEntry = PerChainList | PerChainAssetMap;

export interface ChainAssetPriorityConfig {
  /** Keyed by chainId-as-string. Special key `"default-cross-chain"` for context with `destinationChainId !== chainId`. */
  [chainIdOrSpecial: string]: ChainPriorityEntry;
}

const CROSS_CHAIN_KEY = "default-cross-chain";
const DEFAULT_KEY = "default";

export class ChainAssetPriorityPolicy implements IPriorityPolicy {
  constructor(private readonly config: ChainAssetPriorityConfig) {
    if (!config || typeof config !== "object") {
      throw new CapabilityError({
        code: "CAPABILITY_POLICY_INVALID_CONFIG",
        category: ErrorCategory.INTERNAL,
        message: "ChainAssetPriorityPolicy requires a config object",
      });
    }
  }

  rank<TProvider extends ICapabilityProvider>(
    providers: readonly TProvider[],
    context: PolicyContext
  ): TProvider[] {
    const order = this.resolveOrder(context);
    if (order.length === 0) {
      return [...providers]; // No opinion — preserve registration order.
    }

    const orderIndex = new Map<string, number>();
    for (let i = 0; i < order.length; i++) orderIndex.set(order[i] as string, i);

    // Stable sort: ranked-by-policy first (by index), then the rest in their original order.
    const withIndex = providers.map((p, original) => ({
      p,
      rank: orderIndex.get(p.name) ?? Number.POSITIVE_INFINITY,
      original,
    }));
    withIndex.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.original - b.original;
    });
    return withIndex.map((x) => x.p);
  }

  /**
   * Resolve the priority list for a given context.
   * Lookup order:
   *  1. If context has `destinationChainId !== chainId`, use `default-cross-chain`.
   *  2. Look up `config[chainId.toString()]`.
   *  3. If that entry is a `PerChainAssetMap`, check `by-asset[context.asset]`, then fall back
   *     to `default`.
   *  4. If no match, return an empty list (= no opinion).
   */
  private resolveOrder(context: PolicyContext): string[] {
    if (
      typeof context.destinationChainId === "number" &&
      context.destinationChainId !== context.chainId
    ) {
      const cross = this.config[CROSS_CHAIN_KEY];
      if (cross) return flattenEntry(cross, context.asset);
    }
    const entry = this.config[String(context.chainId)];
    if (!entry) return [];
    return flattenEntry(entry, context.asset);
  }
}

function flattenEntry(entry: ChainPriorityEntry, asset?: string): string[] {
  if (Array.isArray(entry)) return entry;
  if (asset && entry["by-asset"]?.[asset]) return entry["by-asset"][asset]!;
  return entry[DEFAULT_KEY] ?? [];
}

// -------------------------------------------------------------------------------------------------
// fallbackInvoke — the iterate-rank-supportsRoute-call dance, generalised
// -------------------------------------------------------------------------------------------------

export interface FallbackInvokeInput<TProvider extends ICapabilityProvider, TResult> {
  /** Already ranked by the policy. */
  ranked: readonly TProvider[];
  /** Async predicate that asks the provider whether it can serve this route. */
  supportsRoute: (provider: TProvider) => Promise<boolean>;
  /** The work to perform once a supporting provider is found. */
  invoke: (provider: TProvider) => Promise<TResult>;
  /** Capability slug used to build the `CapabilityError` if all fail. */
  capability: string;
  /**
   * Optional classifier — given an error from `invoke`, decide whether to:
   *  - `'fallback'` (default): try the next provider.
   *  - `'rethrow'`: bubble up immediately (e.g. validation errors that no provider can fix).
   */
  shouldFallback?: (error: unknown, provider: TProvider) => "fallback" | "rethrow";
}

export interface FallbackAttempt {
  provider: string;
  reason: string;
}

export interface FallbackInvokeSuccess<TResult, TProvider> {
  ok: true;
  result: TResult;
  provider: TProvider;
  attempts: FallbackAttempt[];
}

export interface FallbackInvokeFailure {
  ok: false;
  error: CapabilityError;
  attempts: FallbackAttempt[];
}

export type FallbackInvokeOutcome<TResult, TProvider> =
  | FallbackInvokeSuccess<TResult, TProvider>
  | FallbackInvokeFailure;

/**
 * Iterate ranked providers, calling the first one that `supportsRoute`. If it fails (and the
 * error is classified as `fallback`), try the next. Returns a result with the full attempts trail.
 *
 * On total failure, throws `CapabilityError.allProvidersFailed`. The caller can choose to
 * return the failure record or rethrow.
 *
 * @example
 *   const outcome = await fallbackInvoke({
 *     ranked, supportsRoute: p => p.supportsRoute(req),
 *     invoke: p => p.prepareSwap(req),
 *     capability: 'swap',
 *   });
 *   if (outcome.ok) return outcome.result;
 *   throw outcome.error;
 */
export async function fallbackInvoke<TProvider extends ICapabilityProvider, TResult>(
  input: FallbackInvokeInput<TProvider, TResult>
): Promise<FallbackInvokeOutcome<TResult, TProvider>> {
  const attempts: FallbackAttempt[] = [];
  const shouldFallback =
    input.shouldFallback ?? defaultShouldFallback;

  for (const provider of input.ranked) {
    let supports: boolean;
    try {
      supports = await input.supportsRoute(provider);
    } catch (e) {
      attempts.push({ provider: provider.name, reason: `supportsRoute threw: ${asMessage(e)}` });
      continue;
    }
    if (!supports) {
      attempts.push({ provider: provider.name, reason: "route unsupported" });
      continue;
    }

    try {
      const result = await input.invoke(provider);
      return { ok: true, result, provider, attempts };
    } catch (e) {
      const decision = shouldFallback(e, provider);
      attempts.push({ provider: provider.name, reason: asMessage(e) });
      if (decision === "rethrow") {
        if (CapabilityError.is(e)) throw e;
        throw CapabilityError.providerFailure({
          capability: input.capability,
          provider: provider.name,
          message: asMessage(e),
          cause: e,
        });
      }
    }
  }

  const error = CapabilityError.allProvidersFailed({
    capability: input.capability,
    attempts: attempts.map((a) => ({ provider: a.provider, error: a.reason })),
  });
  return { ok: false, error, attempts };
}

function defaultShouldFallback(error: unknown): "fallback" | "rethrow" {
  if (CapabilityError.is(error)) {
    // Don't fall back on errors that no other provider can fix.
    switch (error.category) {
      case ErrorCategory.VALIDATION:
      case ErrorCategory.UNSUPPORTED_ROUTE:
        return "rethrow";
      default:
        return "fallback";
    }
  }
  return "fallback";
}

function asMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "<unserialisable error>";
  }
}
