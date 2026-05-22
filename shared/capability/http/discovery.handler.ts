/**
 * Discovery handler — framework-agnostic.
 *
 * The handler builds an `AvailabilityMap` from a registry snapshot + health snapshot, caches it
 * for `cacheTtlSeconds`, and returns a `CapabilitySuccessResponse<AvailabilityMap>` ready to
 * serialise. The HTTP layer wraps it in the framework of choice:
 *
 *     // Express
 *     app.get('/v1/capability/_discovery', async (req, res) => {
 *       const result = await handler({ traceId: req.id, source: 'all' });
 *       res.status(200).json(result);
 *     });
 *
 *     // Fastify
 *     fastify.get('/v1/capability/_discovery', async (req) => handler({ traceId: req.id }));
 *
 * Card #207 (SPRINT_HUGO.md).
 */

import {
  buildAvailabilityMap,
  type AvailabilityMap,
} from "../availability.types";
import { buildSuccess, type CapabilitySuccessResponse, type Uuid } from "../envelope.types";
import type { ICapabilityProvider, ProviderHealth } from "../provider.types";

// -------------------------------------------------------------------------------------------------
// Dependencies the handler needs — framework-agnostic surface.
// -------------------------------------------------------------------------------------------------

export interface DiscoveryHandlerDeps {
  /**
   * Source of providers. Typically `() => registry.listAll({ includeDisabled: false })` but a
   * service may federate across multiple registries (e.g. portfolio-service queries others).
   */
  listProviders: () => ICapabilityProvider[];

  /**
   * Source of latest health probes keyed by provider name. Typically `() => healthTracker.snapshot()`.
   * Optional — when absent, all providers are treated as healthy.
   */
  snapshotHealth?: () => Map<string, ProviderHealth>;

  /** TTL the FE / gateway can cache. Default 30s. */
  cacheTtlSeconds?: number;

  /** Injectable clock for tests. */
  now?: () => Date;
}

// -------------------------------------------------------------------------------------------------
// Handler input/output
// -------------------------------------------------------------------------------------------------

export interface DiscoveryHandlerInput {
  /** Trace id from the request — propagated into the response envelope. */
  traceId: Uuid;
  /**
   * When `force: true`, bypass the in-memory cache and rebuild. Used by ops for diagnostic
   * snapshots after a known incident.
   */
  force?: boolean;
}

export type DiscoveryHandlerOutput = CapabilitySuccessResponse<AvailabilityMap>;

// -------------------------------------------------------------------------------------------------
// Factory — captures deps + cache state
// -------------------------------------------------------------------------------------------------

export interface DiscoveryHandler {
  (input: DiscoveryHandlerInput): DiscoveryHandlerOutput;
  /** Drop the cached snapshot. The next call rebuilds. */
  invalidate(): void;
}

/**
 * Create a discovery handler. Each service composition root creates one and mounts it.
 *
 * The handler is **synchronous** — building the availability map is pure CPU. Network calls
 * (health probes) happen out of band in the `ProviderHealthTracker`.
 */
export function createDiscoveryHandler(deps: DiscoveryHandlerDeps): DiscoveryHandler {
  const cacheTtlSeconds = deps.cacheTtlSeconds ?? 30;
  const now = deps.now ?? (() => new Date());

  let cached: AvailabilityMap | null = null;
  let cachedAtMs = 0;

  const handler = ((input: DiscoveryHandlerInput) => {
    const start = now().getTime();

    const expired = !cached || start - cachedAtMs > cacheTtlSeconds * 1000;
    if (expired || input.force) {
      const map = buildAvailabilityMap({
        providers: deps.listProviders(),
        ...(deps.snapshotHealth && { healthByName: deps.snapshotHealth() }),
        cacheTtlSeconds,
        now: deps.now,
      });
      cached = map;
      cachedAtMs = start;
    }

    const latencyMs = now().getTime() - start;
    return buildSuccess({
      data: cached!,
      provider: { name: "discovery" },
      traceId: input.traceId,
      latencyMs,
    });
  }) as DiscoveryHandler;

  handler.invalidate = () => {
    cached = null;
    cachedAtMs = 0;
  };

  return handler;
}
