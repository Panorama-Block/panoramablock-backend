/**
 * Availability schema — what `/v1/capability/_discovery` returns.
 *
 * The FE consumes this to drive feature visibility ("Lending on Avax is healthy → show menu;
 * unhealthy → grey it out"). Agents consume it before proposing actions ("check availability
 * before suggesting").
 *
 * Real construction happens at runtime by the discovery handler (card #207) which queries the
 * `ProviderRegistry` and `ProviderHealthTracker`. This file defines the **wire shape** and a
 * stub builder used by tests.
 *
 * See CONVENTIONS.md §4 and ADR 002 §"Discovery".
 */

import type { ChainId } from "./envelope.types";
import type {
  CapabilitySlug,
  ICapabilityProvider,
  ProviderHealth,
} from "./provider.types";

// -------------------------------------------------------------------------------------------------
// Wire shape
// -------------------------------------------------------------------------------------------------

/**
 * Single provider's availability on one chain.
 *
 * - `healthy: true` means the provider is currently serving traffic.
 * - `latencyP95Ms` is a rolling 95th percentile from the health tracker; absent on cold start.
 * - `lastError` is the most recent error message when `healthy: false`; truncated to 120 chars.
 */
export interface ProviderAvailability {
  provider: string;
  healthy: boolean;
  latencyP95Ms?: number;
  lastError?: string;
  /** ISO 8601 of the last health probe. */
  lastCheckedAt?: string;
}

/**
 * All providers for one capability, grouped by chain.
 */
export interface CapabilityAvailability {
  capability: CapabilitySlug;
  byChain: Record<ChainId, ProviderAvailability[]>;
}

/**
 * The full discovery payload. Returned by `GET /v1/capability/_discovery` (the handler from
 * card #207 wraps this in a `CapabilityResponse`-shaped envelope plus cache headers).
 */
export interface AvailabilityMap {
  capabilities: CapabilityAvailability[];
  /** When this snapshot was built. */
  generatedAt: string; // ISO 8601
  /** How long the FE / gateway may cache this snapshot. */
  cacheTtlSeconds: number;
}

// -------------------------------------------------------------------------------------------------
// Builder — used by the discovery handler (card #207) and by tests
// -------------------------------------------------------------------------------------------------

export interface BuildAvailabilityInput {
  providers: ICapabilityProvider[];
  /** Map of provider name → latest health probe. Optional; absent → treated as healthy. */
  healthByName?: Map<string, ProviderHealth> | Record<string, ProviderHealth>;
  /** Defaults to 30s — same as the server-side cache. */
  cacheTtlSeconds?: number;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Build an `AvailabilityMap` from a list of registered providers + a health snapshot.
 *
 * This function is pure: same input → same output. The real-time aspects (RPC probing,
 * rolling window of probes) live in `ProviderHealthTracker` (card #209), not here.
 *
 * @example
 *   const map = buildAvailabilityMap({
 *     providers: registry.listAll(),
 *     healthByName: healthTracker.snapshot(),
 *   });
 *   res.json({ status: 'success', data: map, ... });
 */
export function buildAvailabilityMap(input: BuildAvailabilityInput): AvailabilityMap {
  const now = (input.now ?? (() => new Date()))();
  const cacheTtlSeconds = input.cacheTtlSeconds ?? 30;

  const healthLookup = normalizeHealthLookup(input.healthByName);

  // Group: capability → chainId → ProviderAvailability[]
  const byCapability = new Map<CapabilitySlug, Map<ChainId, ProviderAvailability[]>>();

  for (const p of input.providers) {
    if (p.metadata.enabled === false) {
      continue; // Skip stubs; they're built but not announced.
    }

    const health = healthLookup.get(p.name);
    const entry: ProviderAvailability = {
      provider: p.name,
      healthy: health ? health.healthy : true, // Absent health → optimistic.
      ...(health?.latencyMs !== undefined && { latencyP95Ms: health.latencyMs }),
      ...(health?.reason && { lastError: health.reason.slice(0, 120) }),
      ...(health?.checkedAt && { lastCheckedAt: health.checkedAt }),
    };

    const cap = p.metadata.capability;
    const capMap = byCapability.get(cap) ?? new Map<ChainId, ProviderAvailability[]>();
    byCapability.set(cap, capMap);

    for (const chainId of p.metadata.supportedChains) {
      const list = capMap.get(chainId) ?? [];
      list.push(entry);
      capMap.set(chainId, list);
    }
  }

  // Materialise in a stable order: capability slugs alphabetically, chainIds numerically.
  const capabilities: CapabilityAvailability[] = [];
  const sortedCaps = [...byCapability.keys()].sort();
  for (const cap of sortedCaps) {
    const capMap = byCapability.get(cap);
    if (!capMap) continue;
    const byChain: Record<ChainId, ProviderAvailability[]> = {};
    const sortedChains = [...capMap.keys()].sort((a, b) => a - b);
    for (const chainId of sortedChains) {
      const list = capMap.get(chainId);
      if (!list) continue;
      byChain[chainId] = [...list].sort((a, b) => a.provider.localeCompare(b.provider));
    }
    capabilities.push({ capability: cap, byChain });
  }

  return {
    capabilities,
    generatedAt: now.toISOString(),
    cacheTtlSeconds,
  };
}

function normalizeHealthLookup(
  input: BuildAvailabilityInput["healthByName"]
): Map<string, ProviderHealth> {
  if (!input) return new Map();
  if (input instanceof Map) return input;
  return new Map(Object.entries(input));
}
