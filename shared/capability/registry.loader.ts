/**
 * Config-driven provider registration.
 *
 * Each service ships a `config/providers.<env>.json` enumerating the providers to register and
 * a per-provider `enabled` flag. At boot, the DI container calls `loadProvidersFromConfig` with
 * the registry and a factory that knows how to instantiate the concrete adapter for a given name.
 *
 *     loadProvidersFromConfig(registry, {
 *       configPath: 'config/providers.production.json',
 *       factory: (entry) => buildProvider(entry),  // service-specific
 *     });
 *
 * Why a factory:
 *  - Adapters often need dependencies (RPC client, API keys, contract addresses) that the
 *    registry/loader has no opinion on. The service composition root knows.
 *  - This keeps the loader framework-agnostic and testable.
 *
 * See CONVENTIONS.md and card #205 (SPRINT_HUGO.md).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CapabilityError, ErrorCategory } from "./errors";
import type { ICapabilityProvider, ProviderMetadata } from "./provider.types";
import { isCapabilitySlug, validateProviderMetadata } from "./provider.types";
import type { ProviderRegistry } from "./registry";

// -------------------------------------------------------------------------------------------------
// Config shape — what lives on disk
// -------------------------------------------------------------------------------------------------

export interface ProviderConfigEntry {
  name: string;
  capability: string;
  supportedChains: number[];
  features?: string[];
  version: string;
  enabled?: boolean;
  /**
   * Optional adapter-specific configuration bag. The loader does not inspect it; the factory
   * receives the entry and may pull from `.options`.
   */
  options?: Record<string, unknown>;
}

export interface ProviderConfigFile {
  providers: ProviderConfigEntry[];
}

// -------------------------------------------------------------------------------------------------
// Loader input
// -------------------------------------------------------------------------------------------------

/**
 * A factory that turns one config entry into a concrete provider instance.
 * The service composition root provides this — it owns the knowledge of how to construct each
 * adapter (RPC client, contract addresses, API keys, etc).
 *
 * Returning `null` skips the entry without erroring (useful for "this adapter isn't implemented
 * in this binary"). Throwing signals a misconfiguration and aborts the load.
 */
export type ProviderFactory<TProvider extends ICapabilityProvider> = (
  entry: ProviderConfigEntry
) => TProvider | null;

export interface LoaderOptions<TProvider extends ICapabilityProvider> {
  /** Either pass `configPath` (read from disk) or `config` (already parsed). */
  configPath?: string;
  config?: ProviderConfigFile;
  factory: ProviderFactory<TProvider>;
  /**
   * Skip disabled entries. Default `true`. When `false`, disabled entries are still passed to
   * the factory but the registry will keep `metadata.enabled = false` and exclude them by default
   * from `listByChain`.
   */
  skipDisabled?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Result
// -------------------------------------------------------------------------------------------------

export interface LoaderResult {
  registered: string[];
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; error: string }>;
}

// -------------------------------------------------------------------------------------------------
// Implementation
// -------------------------------------------------------------------------------------------------

/**
 * Load providers from config, instantiate via factory, register into the registry.
 *
 * If **any** entry has invalid metadata, the whole load aborts with a `CapabilityError(VALIDATION)`
 * carrying every error — partial loads would leave the system in an inconsistent state.
 *
 * Factory exceptions abort the load as well (the operator needs to fix that before the service
 * can serve traffic).
 *
 * Skipped entries (disabled OR factory returned null) are reported in `result.skipped`.
 */
export function loadProvidersFromConfig<TProvider extends ICapabilityProvider>(
  registry: ProviderRegistry<TProvider>,
  options: LoaderOptions<TProvider>
): LoaderResult {
  const config = readConfig(options);
  const skipDisabled = options.skipDisabled ?? true;

  // 1. Validate every entry's metadata up-front. Aggregate errors.
  const validationErrors: Array<{ name: string; errors: string[] }> = [];
  for (const entry of config.providers) {
    const result = validateProviderMetadata(asMetadata(entry));
    if (!result.ok) {
      validationErrors.push({ name: entry.name ?? "<unnamed>", errors: result.errors });
    }
  }
  if (validationErrors.length > 0) {
    throw new CapabilityError({
      code: "CAPABILITY_REGISTRY_LOAD_FAILED",
      category: ErrorCategory.VALIDATION,
      message: `Provider config invalid: ${validationErrors.length} entrie(s) rejected`,
      details: { validationErrors },
    });
  }

  // 2. Instantiate via factory and register. Track outcomes.
  const result: LoaderResult = { registered: [], skipped: [], errors: [] };

  for (const entry of config.providers) {
    if (skipDisabled && entry.enabled === false) {
      result.skipped.push({ name: entry.name, reason: "disabled in config" });
      continue;
    }

    let instance: TProvider | null;
    try {
      instance = options.factory(entry);
    } catch (e) {
      result.errors.push({ name: entry.name, error: (e as Error).message });
      throw new CapabilityError({
        code: "CAPABILITY_REGISTRY_FACTORY_FAILED",
        category: ErrorCategory.INTERNAL,
        message: `Factory threw for provider "${entry.name}": ${(e as Error).message}`,
        cause: e,
        details: { name: entry.name },
      });
    }

    if (instance === null) {
      result.skipped.push({ name: entry.name, reason: "factory returned null" });
      continue;
    }

    try {
      registry.register(instance);
      result.registered.push(entry.name);
    } catch (e) {
      result.errors.push({ name: entry.name, error: (e as Error).message });
      throw e; // registry errors are fatal; rethrow
    }
  }

  return result;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function readConfig<T extends ICapabilityProvider>(
  options: LoaderOptions<T>
): ProviderConfigFile {
  if (options.config) return options.config;
  if (!options.configPath) {
    throw new CapabilityError({
      code: "CAPABILITY_REGISTRY_LOAD_FAILED",
      category: ErrorCategory.INTERNAL,
      message: "Either configPath or config must be provided",
    });
  }
  const absolute = resolve(options.configPath);
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf-8");
  } catch (e) {
    throw new CapabilityError({
      code: "CAPABILITY_REGISTRY_LOAD_FAILED",
      category: ErrorCategory.INTERNAL,
      message: `Cannot read provider config at ${absolute}: ${(e as Error).message}`,
      cause: e,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CapabilityError({
      code: "CAPABILITY_REGISTRY_LOAD_FAILED",
      category: ErrorCategory.VALIDATION,
      message: `Provider config at ${absolute} is not valid JSON: ${(e as Error).message}`,
      cause: e,
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { providers?: unknown }).providers)
  ) {
    throw new CapabilityError({
      code: "CAPABILITY_REGISTRY_LOAD_FAILED",
      category: ErrorCategory.VALIDATION,
      message: `Provider config at ${absolute} must have shape { providers: [...] }`,
    });
  }
  return parsed as ProviderConfigFile;
}

function asMetadata(entry: ProviderConfigEntry): ProviderMetadata | unknown {
  // If capability is not a known slug we let validateProviderMetadata surface that error;
  // otherwise we cast to the known shape.
  if (!isCapabilitySlug(entry.capability)) {
    return entry; // validator will reject
  }
  return {
    name: entry.name,
    capability: entry.capability,
    supportedChains: entry.supportedChains,
    version: entry.version,
    ...(entry.features !== undefined && { features: entry.features }),
    ...(entry.enabled !== undefined && { enabled: entry.enabled }),
  } satisfies ProviderMetadata;
}
