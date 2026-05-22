/**
 * ProviderRegistry — generic container for capability providers.
 *
 * Each backend service instantiates **one** registry per capability it serves:
 *
 *     const registry = new ProviderRegistry<ISwapProvider>();
 *     registry.register(new UniswapSwapAdapter(...));
 *     registry.register(new ThirdwebSwapAdapter(...));
 *     registry.register(new AerodromeSwapAdapter(...));
 *
 * Then the capability facade asks the registry for ranked candidates:
 *
 *     const candidates = registry.listByChain(req.chainId);
 *     const ranked = policy.rank(candidates, req);
 *     // ... iterate, call supportsRoute, call the action
 *
 * The registry is **not** aware of policy or transport. It only answers structural questions:
 * "what's registered? what supports this chain? who's healthy?".
 *
 * See ADR 002 (capability + provider) and CONVENTIONS.md §7 (imports).
 */

import { CapabilityError, ErrorCategory } from "./errors";
import type {
  CapabilitySlug,
  ICapabilityProvider,
  ProviderMetadata,
} from "./provider.types";
import { validateProviderMetadata } from "./provider.types";
import type { ChainId } from "./envelope.types";
import type {
  HealthOracle,
  ListByChainOptions,
  RegistryEvent,
  RegistryListener,
  RegistryListFilter,
} from "./registry.types";

const ALWAYS_HEALTHY: HealthOracle = { isHealthy: () => true };

export class ProviderRegistry<TProvider extends ICapabilityProvider> {
  private readonly providers = new Map<string, TProvider>();
  private readonly listeners = new Set<RegistryListener>();
  private healthOracle: HealthOracle = ALWAYS_HEALTHY;

  /**
   * Register a provider. The metadata is validated before insertion; an invalid metadata
   * throws a `CapabilityError(VALIDATION)`.
   *
   * Duplicate names throw — the registry is the single source of truth for provider identity.
   */
  register(provider: TProvider): void {
    const validation = validateProviderMetadata(provider.metadata);
    if (!validation.ok) {
      throw new CapabilityError({
        code: "CAPABILITY_REGISTRY_INVALID_METADATA",
        category: ErrorCategory.VALIDATION,
        message: `Cannot register provider "${maybeName(provider)}": metadata invalid`,
        details: { errors: validation.errors, name: maybeName(provider) },
      });
    }

    if (provider.name !== provider.metadata.name) {
      throw new CapabilityError({
        code: "CAPABILITY_REGISTRY_NAME_MISMATCH",
        category: ErrorCategory.VALIDATION,
        message: `Provider name "${provider.name}" does not match metadata.name "${provider.metadata.name}"`,
        details: { topLevelName: provider.name, metadataName: provider.metadata.name },
      });
    }

    if (this.providers.has(provider.name)) {
      throw new CapabilityError({
        code: "CAPABILITY_REGISTRY_DUPLICATE",
        category: ErrorCategory.VALIDATION,
        message: `Provider "${provider.name}" is already registered`,
        details: { name: provider.name },
      });
    }

    this.providers.set(provider.name, provider);
    this.emit({ kind: "registered", provider });
  }

  /**
   * Unregister a provider by name. Returns `true` if it existed, `false` otherwise.
   * Mainly used in tests and in hot-swap scenarios; in production providers come and go via deploys.
   */
  unregister(name: string): boolean {
    const had = this.providers.delete(name);
    if (had) this.emit({ kind: "unregistered", providerName: name });
    return had;
  }

  /**
   * Lookup by exact name. Returns `undefined` when missing — callers decide how to react.
   * No alias resolution; that's the policy's job (see `provider-selector.service.ts`).
   */
  getByName(name: string): TProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Total number of registered providers regardless of capability / chain / health.
   */
  size(): number {
    return this.providers.size;
  }

  /**
   * List all providers matching the optional filter.
   *
   * Defaults:
   *  - `capability` — no filter
   *  - `healthy` — no filter (returns healthy and unhealthy alike)
   *  - `includeDisabled` — false (stubs with `metadata.enabled === false` are excluded)
   */
  listAll(filter: RegistryListFilter = {}): TProvider[] {
    const out: TProvider[] = [];
    for (const p of this.providers.values()) {
      if (filter.capability && p.metadata.capability !== filter.capability) continue;
      if (!filter.includeDisabled && p.metadata.enabled === false) continue;
      if (filter.healthy !== undefined) {
        const healthy = this.healthOracle.isHealthy(p.name);
        if (filter.healthy && !healthy) continue;
        if (!filter.healthy && healthy) continue;
      }
      out.push(p);
    }
    return out;
  }

  /**
   * Providers that declare support for `chainId`. By default excludes disabled stubs and
   * unhealthy providers — that's the production default the facades rely on.
   *
   * Use `{ healthy: undefined }` to include unhealthy providers (e.g. for diagnostic views).
   */
  listByChain(
    chainId: ChainId,
    options: ListByChainOptions = {}
  ): TProvider[] {
    const includeDisabled = options.includeDisabled ?? false;
    // Distinguish "key absent" (default = healthy-only) from "key present as undefined"
    // (caller explicitly asked to skip health filtering). `?? true` would collapse both.
    const healthyFilter = "healthy" in options ? options.healthy : true;
    const cap = options.capability;

    const out: TProvider[] = [];
    for (const p of this.providers.values()) {
      if (cap && p.metadata.capability !== cap) continue;
      if (!includeDisabled && p.metadata.enabled === false) continue;
      if (!p.metadata.supportedChains.includes(chainId)) continue;
      if (healthyFilter === true && !this.healthOracle.isHealthy(p.name)) continue;
      if (healthyFilter === false && this.healthOracle.isHealthy(p.name)) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * Attach a health oracle (typically `ProviderHealthTracker` from card #209).
   * Calling this twice replaces the previous oracle.
   *
   * When detached (passing `undefined`), the registry reverts to "all healthy" — useful in tests.
   */
  attachHealthOracle(oracle: HealthOracle | undefined): void {
    this.healthOracle = oracle ?? ALWAYS_HEALTHY;
  }

  /**
   * Subscribe to registry events. Returns an unsubscribe function.
   */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Materialise the metadata of every registered provider. Convenient for the discovery
   * handler (card #207) and for the conformance test helper.
   */
  metadataSnapshot(): ProviderMetadata[] {
    return [...this.providers.values()].map((p) => p.metadata);
  }

  /**
   * Clear the registry. Test-only — production code should not call this.
   */
  clear(): void {
    const names = [...this.providers.keys()];
    this.providers.clear();
    for (const n of names) this.emit({ kind: "unregistered", providerName: n });
  }

  private emit(event: RegistryEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // Listener errors are isolated — the registry never throws from emit.
      }
    }
  }
}

function maybeName(p: ICapabilityProvider): string {
  return typeof p.name === "string" ? p.name : "<unknown>";
}
