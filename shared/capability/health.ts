/**
 * ProviderHealthTracker — periodic health probes + a `HealthOracle` for the registry.
 *
 * The tracker polls each provider's optional `healthCheck()` every `intervalMs`. After 3
 * consecutive failures the provider is marked unhealthy; one success flips it back. The registry
 * (when this tracker is attached as its `HealthOracle`) automatically excludes unhealthy providers
 * from `listByChain`, so the capability facade keeps serving without 500s.
 *
 * Card #209 (SPRINT_HUGO.md).
 */

import type { ICapabilityProvider, ProviderHealth } from "./provider.types";
import type { HealthOracle } from "./registry.types";

// -------------------------------------------------------------------------------------------------
// State per provider
// -------------------------------------------------------------------------------------------------

interface ProviderState {
  name: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastProbe?: ProviderHealth;
  latencySamplesMs: number[]; // bounded window — keep last N for p95
}

const LATENCY_WINDOW = 50;

export interface ProviderHealthReport {
  name: string;
  healthy: boolean;
  consecutiveFailures: number;
  latencyP95Ms?: number;
  lastCheckedAt?: string;
  lastReason?: string;
}

export interface ProviderHealthTrackerOptions {
  /** Probe interval. Default 30 000 (30 s). */
  intervalMs?: number;
  /** Failures in a row before a provider is marked unhealthy. Default 3. */
  unhealthyAfter?: number;
  /** Per-probe timeout. Default 5 000 ms. */
  probeTimeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable scheduler for tests. Default uses `setInterval` / `clearInterval`. */
  scheduler?: HealthScheduler;
  /** When a probe throws, this is reported as the reason. */
  onError?: (providerName: string, error: unknown) => void;
}

/**
 * Minimal scheduler surface — abstracted so tests can step time deterministically without
 * fake-timers gymnastics.
 */
export interface HealthScheduler {
  start(cb: () => void, intervalMs: number): HealthSchedulerHandle;
}
export interface HealthSchedulerHandle {
  stop(): void;
}

const defaultScheduler: HealthScheduler = {
  start(cb, intervalMs) {
    const handle = setInterval(cb, intervalMs);
    // `unref` so the timer doesn't keep Node alive on shutdown.
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      (handle as { unref: () => void }).unref();
    }
    return {
      stop() {
        clearInterval(handle);
      },
    };
  },
};

// -------------------------------------------------------------------------------------------------
// The tracker
// -------------------------------------------------------------------------------------------------

export class ProviderHealthTracker implements HealthOracle {
  private readonly providers = new Map<string, ICapabilityProvider>();
  private readonly state = new Map<string, ProviderState>();
  private handle?: HealthSchedulerHandle;
  private readonly intervalMs: number;
  private readonly unhealthyAfter: number;
  private readonly probeTimeoutMs: number;
  private readonly now: () => Date;
  private readonly scheduler: HealthScheduler;
  private readonly onError?: (providerName: string, error: unknown) => void;

  constructor(options: ProviderHealthTrackerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.unhealthyAfter = options.unhealthyAfter ?? 3;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.onError = options.onError;
  }

  /**
   * Register a provider for tracking. Providers without `healthCheck()` are recorded but always
   * reported as healthy (graceful).
   */
  track(provider: ICapabilityProvider): void {
    if (this.providers.has(provider.name)) return;
    this.providers.set(provider.name, provider);
    this.state.set(provider.name, {
      name: provider.name,
      healthy: true,
      consecutiveFailures: 0,
      latencySamplesMs: [],
    });
  }

  /** Stop tracking a provider (e.g. on hot unregister). */
  untrack(name: string): void {
    this.providers.delete(name);
    this.state.delete(name);
  }

  /** Required by `HealthOracle`. */
  isHealthy(providerName: string): boolean {
    const s = this.state.get(providerName);
    if (!s) return true; // not tracked = no data = assume healthy
    return s.healthy;
  }

  /**
   * Start the polling loop. Idempotent — calling twice is a no-op.
   * Does NOT block: returns immediately after scheduling.
   */
  start(): void {
    if (this.handle) return;
    this.handle = this.scheduler.start(() => {
      void this.probeAll();
    }, this.intervalMs);
  }

  /** Stop polling. Safe to call before `start`. */
  stop(): void {
    this.handle?.stop();
    this.handle = undefined;
  }

  /**
   * Manually mark a provider unhealthy with a reason. Used by the facade when a provider error
   * indicates the provider itself is degraded (not just a per-request failure).
   */
  markUnhealthy(name: string, reason: string): void {
    const s = this.state.get(name);
    if (!s) return;
    s.healthy = false;
    s.consecutiveFailures = Math.max(s.consecutiveFailures, this.unhealthyAfter);
    s.lastProbe = {
      healthy: false,
      reason,
      checkedAt: this.now().toISOString(),
    };
  }

  /**
   * Manually mark a provider healthy. Used when an external signal proves the provider is back.
   */
  markHealthy(name: string): void {
    const s = this.state.get(name);
    if (!s) return;
    s.healthy = true;
    s.consecutiveFailures = 0;
    s.lastProbe = { healthy: true, checkedAt: this.now().toISOString() };
  }

  /**
   * Snapshot of current health for every tracked provider. Useful for the discovery endpoint.
   */
  snapshot(): Map<string, ProviderHealth> {
    const out = new Map<string, ProviderHealth>();
    for (const [name, s] of this.state) {
      if (!s.lastProbe) continue;
      out.set(name, { ...s.lastProbe });
    }
    return out;
  }

  /**
   * Aggregated report for `/v1/capability/monitoring/...` (consumed by `monitoring-service`).
   */
  report(): ProviderHealthReport[] {
    return [...this.state.values()].map((s) => ({
      name: s.name,
      healthy: s.healthy,
      consecutiveFailures: s.consecutiveFailures,
      ...(s.latencySamplesMs.length > 0 && {
        latencyP95Ms: percentile(s.latencySamplesMs, 95),
      }),
      ...(s.lastProbe?.checkedAt && { lastCheckedAt: s.lastProbe.checkedAt }),
      ...(s.lastProbe?.reason && { lastReason: s.lastProbe.reason }),
    }));
  }

  /**
   * Force a probe sweep right now. Useful for tests, for `/health` endpoints that want fresh data,
   * and for the initial health hydration after boot.
   */
  async probeAll(): Promise<void> {
    const ops = [...this.providers.values()].map((p) => this.probeOne(p));
    await Promise.all(ops);
  }

  /**
   * Probe a single provider. Public to allow targeted re-probe after a known incident.
   */
  async probeOne(provider: ICapabilityProvider): Promise<void> {
    const s = this.state.get(provider.name);
    if (!s) return;

    if (!provider.healthCheck) {
      // No probe available — treat as continuously healthy without spending any sample slot.
      s.healthy = true;
      s.consecutiveFailures = 0;
      return;
    }

    const startedAt = Date.now();
    let probe: ProviderHealth;
    try {
      probe = await withTimeout(provider.healthCheck(), this.probeTimeoutMs);
    } catch (e) {
      this.onError?.(provider.name, e);
      probe = {
        healthy: false,
        reason: asMessage(e),
        latencyMs: Date.now() - startedAt,
        checkedAt: this.now().toISOString(),
      };
    }

    // Normalise checkedAt
    if (!probe.checkedAt) probe = { ...probe, checkedAt: this.now().toISOString() };
    s.lastProbe = probe;
    if (typeof probe.latencyMs === "number") {
      s.latencySamplesMs.push(probe.latencyMs);
      if (s.latencySamplesMs.length > LATENCY_WINDOW) s.latencySamplesMs.shift();
    }

    if (probe.healthy) {
      s.healthy = true;
      s.consecutiveFailures = 0;
    } else {
      s.consecutiveFailures += 1;
      if (s.consecutiveFailures >= this.unhealthyAfter) {
        s.healthy = false;
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then(
      (v) => {
        if (timer) clearTimeout(timer);
        return v;
      },
      (e) => {
        if (timer) clearTimeout(timer);
        throw e;
      }
    ),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`healthCheck timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
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
