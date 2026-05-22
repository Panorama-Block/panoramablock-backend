/**
 * Chain manifest — first-class entity for supported chains.
 *
 * Every supported chain is described by a JSON file in this directory. Consumers go through
 * `getChain(idOrSlug)` rather than using literal chain ids — see ADR 005.
 *
 * Cards #211–#214 (SPRINT_HUGO.md).
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CapabilityError, ErrorCategory } from "../errors";
import type { CapabilitySlug } from "../provider.types";
import { isCapabilitySlug } from "../provider.types";

// -------------------------------------------------------------------------------------------------
// The manifest shape
// -------------------------------------------------------------------------------------------------

export interface ChainNativeAsset {
  symbol: string;
  decimals: number;
}

export interface ChainManifest {
  id: number;
  /** kebab-case canonical id (e.g. 'base', 'avalanche', 'ethereum'). */
  slug: string;
  /** Display name (e.g. 'Base', 'Avalanche', 'Ethereum'). */
  name: string;
  nativeAsset: ChainNativeAsset;
  /** Public RPC defaults — never put API keys here. */
  rpcDefaults: string[];
  blockExplorerUrl: string;
  capabilitiesSupported: CapabilitySlug[];
}

// -------------------------------------------------------------------------------------------------
// Loading + lookup
// -------------------------------------------------------------------------------------------------

export interface LoadChainsOptions {
  /** Where to look for `*.manifest.json` files. Defaults to this `chains/` directory. */
  directory?: string;
  /** Inject manifests directly (skip filesystem). Wins over `directory`. */
  manifests?: ChainManifest[];
}

let cached: ChainManifest[] | null = null;
let cachedById = new Map<number, ChainManifest>();
let cachedBySlug = new Map<string, ChainManifest>();

/**
 * Resolve the default chains directory (where `*.manifest.json` files live).
 *
 * Works under tsx/ts-node (no compile step) by using `__dirname` when available (CJS) or
 * `import.meta.url` derivation when running as ESM. Falls back to the source dir.
 */
function defaultChainsDir(): string {
  // CJS path (vitest + ts-jest default).
  if (typeof __dirname !== "undefined") return __dirname;
  // ESM fallback: derive from this module URL.
  // Guarded behind try/catch because `import.meta` is a syntax error in some CJS contexts.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (Function("return import.meta.url") as () => string)();
    return dirname(fileURLToPath(url));
  } catch {
    return resolve(process.cwd(), "shared/capability/chains");
  }
}

/**
 * Load chain manifests from disk (or from `manifests` if provided) and populate the lookup caches.
 * Idempotent — calling twice with the same source returns the same array. Pass `{ reload: true }`
 * to force a re-read (test convenience; production calls this once at boot).
 *
 * Throws `CapabilityError(VALIDATION)` aggregating every malformed manifest.
 */
export function loadChains(
  options: LoadChainsOptions & { reload?: boolean } = {}
): ChainManifest[] {
  if (cached && !options.reload && !options.manifests && !options.directory) {
    return cached;
  }

  const raw: RawManifest[] = options.manifests
    ? options.manifests.map((m, i) => ({ source: `injected[${i}]`, manifest: m }))
    : readManifestsFromDir(options.directory ?? defaultChainsDir());
  const errors: Array<{ source: string; errors: string[] }> = [];
  const valid: ChainManifest[] = [];

  for (const entry of raw) {
    const result = validateChainManifest(entry.manifest);
    if (!result.ok) {
      errors.push({ source: entry.source, errors: result.errors });
      continue;
    }
    valid.push(entry.manifest as ChainManifest);
  }

  if (errors.length > 0) {
    throw new CapabilityError({
      code: "CAPABILITY_CHAIN_LOAD_FAILED",
      category: ErrorCategory.VALIDATION,
      message: `Chain manifest load failed: ${errors.length} invalid file(s)`,
      details: { errors },
    });
  }

  // Reject duplicate ids or slugs across files.
  const seenIds = new Set<number>();
  const seenSlugs = new Set<string>();
  for (const m of valid) {
    if (seenIds.has(m.id)) {
      throw new CapabilityError({
        code: "CAPABILITY_CHAIN_DUPLICATE_ID",
        category: ErrorCategory.VALIDATION,
        message: `Duplicate chain id ${m.id} across manifests`,
        details: { id: m.id },
      });
    }
    if (seenSlugs.has(m.slug)) {
      throw new CapabilityError({
        code: "CAPABILITY_CHAIN_DUPLICATE_SLUG",
        category: ErrorCategory.VALIDATION,
        message: `Duplicate chain slug "${m.slug}" across manifests`,
        details: { slug: m.slug },
      });
    }
    seenIds.add(m.id);
    seenSlugs.add(m.slug);
  }

  cached = valid;
  cachedById = new Map(valid.map((m) => [m.id, m]));
  cachedBySlug = new Map(valid.map((m) => [m.slug, m]));
  return valid;
}

/**
 * Lookup a chain by id (number) or slug (string). Throws `CapabilityError(VALIDATION)` if
 * the chain isn't loaded — never return undefined silently, since most call sites would
 * NPE shortly after.
 *
 * Auto-loads from the default directory on first call.
 */
export function getChain(idOrSlug: number | string): ChainManifest {
  if (!cached) loadChains();
  const found =
    typeof idOrSlug === "number"
      ? cachedById.get(idOrSlug)
      : cachedBySlug.get(idOrSlug);
  if (!found) {
    throw new CapabilityError({
      code: "CAPABILITY_CHAIN_UNKNOWN",
      category: ErrorCategory.VALIDATION,
      message: `Unknown chain ${JSON.stringify(idOrSlug)}. Known: ${listKnownChains().join(", ")}`,
      details: { lookup: idOrSlug, known: listKnownChains() },
    });
  }
  return found;
}

/**
 * Same as `getChain` but returns `undefined` when missing. Use when the caller already plans for
 * "chain not configured" as a valid branch (e.g. policy fallback).
 */
export function tryGetChain(idOrSlug: number | string): ChainManifest | undefined {
  if (!cached) loadChains();
  return typeof idOrSlug === "number"
    ? cachedById.get(idOrSlug)
    : cachedBySlug.get(idOrSlug);
}

/**
 * All loaded chains. Auto-loads on first call.
 */
export function listChains(): ChainManifest[] {
  if (!cached) loadChains();
  return cached!;
}

/**
 * Human-readable list of `<slug>(<id>)` for error messages.
 */
export function listKnownChains(): string[] {
  if (!cached) loadChains();
  return cached!.map((m) => `${m.slug}(${m.id})`);
}

/**
 * Test convenience — clear the lazy cache and lookups.
 */
export function _resetChainsCache(): void {
  cached = null;
  cachedById = new Map();
  cachedBySlug = new Map();
}

// -------------------------------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------------------------------

interface ValidationOk {
  ok: true;
}
interface ValidationErr {
  ok: false;
  errors: string[];
}
type ValidationResult = ValidationOk | ValidationErr;

export function validateChainManifest(m: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof m !== "object" || m === null) {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const x = m as Partial<ChainManifest>;

  if (!Number.isInteger(x.id) || (x.id as number) <= 0) {
    errors.push(`id must be a positive integer (got ${JSON.stringify(x.id)})`);
  }

  if (typeof x.slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(x.slug)) {
    errors.push(
      `slug must be lowercase kebab-case starting with letter (got ${JSON.stringify(x.slug)})`
    );
  }

  if (typeof x.name !== "string" || x.name.length === 0) {
    errors.push("name must be a non-empty string");
  }

  if (
    typeof x.nativeAsset !== "object" ||
    x.nativeAsset === null ||
    typeof x.nativeAsset.symbol !== "string" ||
    x.nativeAsset.symbol.length === 0 ||
    !Number.isInteger(x.nativeAsset.decimals) ||
    (x.nativeAsset.decimals as number) < 0
  ) {
    errors.push("nativeAsset must be { symbol: non-empty string, decimals: non-negative integer }");
  }

  if (
    !Array.isArray(x.rpcDefaults) ||
    x.rpcDefaults.length === 0 ||
    x.rpcDefaults.some((r) => typeof r !== "string" || !/^https?:\/\//.test(r as string))
  ) {
    errors.push(
      "rpcDefaults must be a non-empty array of http(s) URLs (no API keys in defaults)"
    );
  }

  if (typeof x.blockExplorerUrl !== "string" || !/^https?:\/\//.test(x.blockExplorerUrl)) {
    errors.push("blockExplorerUrl must be a valid http(s) URL");
  }

  if (
    !Array.isArray(x.capabilitiesSupported) ||
    x.capabilitiesSupported.some((c) => !isCapabilitySlug(c))
  ) {
    errors.push("capabilitiesSupported must be an array of known CapabilitySlug values");
  } else if (new Set(x.capabilitiesSupported).size !== x.capabilitiesSupported.length) {
    errors.push("capabilitiesSupported must not contain duplicates");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// -------------------------------------------------------------------------------------------------
// FS helpers
// -------------------------------------------------------------------------------------------------

interface RawManifest {
  source: string;
  manifest: unknown;
}

function readManifestsFromDir(dir: string): RawManifest[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new CapabilityError({
      code: "CAPABILITY_CHAIN_LOAD_FAILED",
      category: ErrorCategory.INTERNAL,
      message: `Chains directory not found: ${dir}`,
    });
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".manifest.json") && extname(f) === ".json")
    .map((f) => join(dir, f))
    .sort();
  return files.map((path) => {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (e) {
      throw new CapabilityError({
        code: "CAPABILITY_CHAIN_LOAD_FAILED",
        category: ErrorCategory.INTERNAL,
        message: `Cannot read manifest ${path}: ${(e as Error).message}`,
        cause: e,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new CapabilityError({
        code: "CAPABILITY_CHAIN_LOAD_FAILED",
        category: ErrorCategory.VALIDATION,
        message: `Manifest ${path} is not valid JSON: ${(e as Error).message}`,
      });
    }
    return { source: path, manifest: parsed };
  });
}
