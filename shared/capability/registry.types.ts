/**
 * Types used by the ProviderRegistry that aren't part of the public envelope/provider API.
 *
 * Keeping them in a sibling file so `registry.ts` stays focused on behaviour.
 */

import type { CapabilitySlug, ICapabilityProvider } from "./provider.types";
import type { ChainId } from "./envelope.types";

/**
 * Filter passed to `registry.listAll`.
 *
 * - `capability` — only return providers for this slug.
 * - `healthy` — when `true`, exclude providers that have been marked unhealthy.
 *   When `undefined`, returns every registered provider regardless of health.
 *   When `false`, returns only the unhealthy ones (useful for monitoring views).
 * - `includeDisabled` — when `true`, include providers with `metadata.enabled === false`
 *   (stubs). Default: `false`.
 */
export interface RegistryListFilter {
  capability?: CapabilitySlug;
  healthy?: boolean;
  includeDisabled?: boolean;
}

/**
 * The health view a Registry consults when filtering. The full implementation lives in
 * `health.ts` (card #209); this is the narrow contract the registry depends on so the two
 * modules can be tested independently.
 */
export interface HealthOracle {
  isHealthy(providerName: string): boolean;
}

/**
 * Registry events surfaced to subscribers (currently used by the conformance helper and the
 * health tracker integration). Lightweight; do not abuse with high-frequency events.
 */
export type RegistryEvent =
  | { kind: "registered"; provider: ICapabilityProvider }
  | { kind: "unregistered"; providerName: string };

export type RegistryListener = (event: RegistryEvent) => void;

/**
 * A shorthand for "all providers in this registry that match a chain".
 *
 * The registry guarantees `result.every(p => p.metadata.supportedChains.includes(chainId))`.
 */
export interface ListByChainOptions {
  capability?: CapabilitySlug;
  healthy?: boolean;
  includeDisabled?: boolean;
}

export type { CapabilitySlug, ICapabilityProvider, ChainId };
