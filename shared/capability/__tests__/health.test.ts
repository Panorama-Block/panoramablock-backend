import { describe, it, expect, vi } from "vitest";

import {
  ProviderHealthTracker,
  type HealthScheduler,
} from "../health";
import type { ICapabilityProvider, ProviderHealth } from "../provider.types";

function makeProvider(
  name: string,
  healthCheck?: () => Promise<ProviderHealth>
): ICapabilityProvider {
  return {
    name,
    metadata: {
      name,
      capability: "swap",
      supportedChains: [1],
      version: "1.0.0",
    },
    ...(healthCheck && { healthCheck }),
  };
}

/** Manual scheduler: only fires when test calls `tick()`. */
function manualScheduler() {
  let cb: (() => void) | null = null;
  const scheduler: HealthScheduler = {
    start(c) {
      cb = c;
      return {
        stop() {
          cb = null;
        },
      };
    },
  };
  return { scheduler, tick: () => cb?.() };
}

describe("ProviderHealthTracker — provider without healthCheck", () => {
  it("is always healthy (graceful)", async () => {
    const tracker = new ProviderHealthTracker();
    tracker.track(makeProvider("uniswap"));
    expect(tracker.isHealthy("uniswap")).toBe(true);
    await tracker.probeAll();
    expect(tracker.isHealthy("uniswap")).toBe(true);
  });

  it("snapshot is empty for providers without probes", async () => {
    const tracker = new ProviderHealthTracker();
    tracker.track(makeProvider("uniswap"));
    await tracker.probeAll();
    expect(tracker.snapshot().size).toBe(0);
  });
});

describe("ProviderHealthTracker — happy probe", () => {
  it("records latency + marks healthy", async () => {
    const probe = vi.fn(async () => ({
      healthy: true,
      latencyMs: 42,
      checkedAt: "2026-05-22T00:00:00Z",
    }));
    const tracker = new ProviderHealthTracker({ now: () => new Date("2026-05-22T00:00:00Z") });
    tracker.track(makeProvider("uniswap", probe));
    await tracker.probeAll();
    expect(probe).toHaveBeenCalledOnce();
    expect(tracker.isHealthy("uniswap")).toBe(true);
    const snap = tracker.snapshot().get("uniswap");
    expect(snap?.healthy).toBe(true);
    expect(snap?.latencyMs).toBe(42);
  });

  it("p95 latency populates after enough samples", async () => {
    const latencies = [10, 12, 15, 20, 30, 50, 100, 200, 500, 1000];
    let i = 0;
    const probe = async () => ({
      healthy: true,
      latencyMs: latencies[i++ % latencies.length] as number,
      checkedAt: "x",
    });
    const tracker = new ProviderHealthTracker();
    tracker.track(makeProvider("u", probe));
    for (let n = 0; n < 10; n++) await tracker.probeAll();
    const report = tracker.report().find((r) => r.name === "u");
    expect(report?.healthy).toBe(true);
    expect(report?.latencyP95Ms).toBeGreaterThan(200);
  });
});

describe("ProviderHealthTracker — failure threshold", () => {
  it("requires N consecutive failures (default 3) to flip unhealthy", async () => {
    let nextHealthy = false;
    const probe = vi.fn(async () => ({
      healthy: nextHealthy,
      latencyMs: 5,
      checkedAt: "x",
    }));
    const tracker = new ProviderHealthTracker({ unhealthyAfter: 3 });
    tracker.track(makeProvider("u", probe));

    await tracker.probeAll(); // fail #1
    expect(tracker.isHealthy("u")).toBe(true);
    await tracker.probeAll(); // fail #2
    expect(tracker.isHealthy("u")).toBe(true);
    await tracker.probeAll(); // fail #3 → unhealthy
    expect(tracker.isHealthy("u")).toBe(false);

    nextHealthy = true;
    await tracker.probeAll(); // success
    expect(tracker.isHealthy("u")).toBe(true);
  });

  it("one success resets consecutiveFailures", async () => {
    let pattern = [false, false, true, false, false]; // success at #3 should reset counter
    let i = 0;
    const probe = async () => ({
      healthy: pattern[i++] ?? false,
      checkedAt: "x",
      latencyMs: 1,
    });
    const tracker = new ProviderHealthTracker({ unhealthyAfter: 3 });
    tracker.track(makeProvider("u", probe));
    await tracker.probeAll();
    await tracker.probeAll();
    await tracker.probeAll(); // success
    expect(tracker.isHealthy("u")).toBe(true);
    await tracker.probeAll();
    await tracker.probeAll();
    expect(tracker.isHealthy("u")).toBe(true); // only 2 failures after reset
  });
});

describe("ProviderHealthTracker — exceptions in healthCheck", () => {
  it("treats thrown error as unhealthy probe + calls onError", async () => {
    const onError = vi.fn();
    const tracker = new ProviderHealthTracker({ unhealthyAfter: 1, onError });
    tracker.track(
      makeProvider("u", async () => {
        throw new Error("rpc unreachable");
      })
    );
    await tracker.probeAll();
    expect(tracker.isHealthy("u")).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    const snap = tracker.snapshot().get("u");
    expect(snap?.healthy).toBe(false);
    expect(snap?.reason).toBe("rpc unreachable");
  });
});

describe("ProviderHealthTracker — manual marks", () => {
  it("markUnhealthy flips state without a probe", () => {
    const tracker = new ProviderHealthTracker({ unhealthyAfter: 3 });
    tracker.track(makeProvider("u", async () => ({ healthy: true, checkedAt: "x" })));
    tracker.markUnhealthy("u", "manually disabled");
    expect(tracker.isHealthy("u")).toBe(false);
    const snap = tracker.snapshot().get("u");
    expect(snap?.reason).toBe("manually disabled");
  });

  it("markHealthy resets counters", async () => {
    const tracker = new ProviderHealthTracker({ unhealthyAfter: 1 });
    tracker.track(
      makeProvider("u", async () => ({ healthy: false, checkedAt: "x" }))
    );
    await tracker.probeAll();
    expect(tracker.isHealthy("u")).toBe(false);
    tracker.markHealthy("u");
    expect(tracker.isHealthy("u")).toBe(true);
  });

  it("markUnhealthy on untracked provider is a silent no-op", () => {
    const tracker = new ProviderHealthTracker();
    expect(() => tracker.markUnhealthy("ghost", "x")).not.toThrow();
  });
});

describe("ProviderHealthTracker — scheduler integration", () => {
  it("start fires probeAll on each tick", async () => {
    const { scheduler, tick } = manualScheduler();
    const probe = vi.fn(async () => ({ healthy: true, checkedAt: "x", latencyMs: 1 }));
    const tracker = new ProviderHealthTracker({ scheduler });
    tracker.track(makeProvider("u", probe));
    tracker.start();

    tick();
    await Promise.resolve(); // let microtasks flush
    await Promise.resolve();
    expect(probe).toHaveBeenCalledOnce();

    tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(2);

    tracker.stop();
    tick();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(2); // stopped — no more ticks
  });

  it("start is idempotent", () => {
    const { scheduler } = manualScheduler();
    const startSpy = vi.spyOn(scheduler, "start");
    const tracker = new ProviderHealthTracker({ scheduler });
    tracker.start();
    tracker.start();
    expect(startSpy).toHaveBeenCalledOnce();
  });
});

describe("ProviderHealthTracker — untracked providers", () => {
  it("isHealthy returns true for unknown name (no data = optimistic)", () => {
    const tracker = new ProviderHealthTracker();
    expect(tracker.isHealthy("ghost")).toBe(true);
  });

  it("untrack removes from state and snapshot", async () => {
    const tracker = new ProviderHealthTracker();
    tracker.track(makeProvider("u", async () => ({ healthy: true, checkedAt: "x" })));
    await tracker.probeAll();
    expect(tracker.snapshot().has("u")).toBe(true);
    tracker.untrack("u");
    expect(tracker.snapshot().has("u")).toBe(false);
  });
});

describe("ProviderHealthTracker — report", () => {
  it("returns one entry per tracked provider", async () => {
    const tracker = new ProviderHealthTracker();
    tracker.track(makeProvider("u1", async () => ({ healthy: true, checkedAt: "x", latencyMs: 5 })));
    tracker.track(makeProvider("u2"));
    await tracker.probeAll();
    const report = tracker.report();
    expect(report.map((r) => r.name).sort()).toEqual(["u1", "u2"]);
    expect(report.find((r) => r.name === "u1")?.latencyP95Ms).toBe(5);
    expect(report.find((r) => r.name === "u2")?.latencyP95Ms).toBeUndefined();
  });
});
