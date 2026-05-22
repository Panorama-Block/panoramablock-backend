import { describe, it, expect, vi } from "vitest";

import { createDiscoveryHandler } from "../discovery.handler";
import type { ICapabilityProvider, ProviderHealth } from "../../provider.types";

function provider(input: {
  name: string;
  capability?: "swap" | "lending" | "staking";
  supportedChains?: number[];
}): ICapabilityProvider {
  return {
    name: input.name,
    metadata: {
      name: input.name,
      capability: input.capability ?? "swap",
      supportedChains: input.supportedChains ?? [1],
      version: "1.0.0",
    },
  };
}

const TRACE = "trace-abc-123";

function fixedTime() {
  let current = new Date("2026-05-22T00:00:00Z").getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("discovery.handler — basic shape", () => {
  it("returns a success envelope wrapping AvailabilityMap", () => {
    const clock = fixedTime();
    const handler = createDiscoveryHandler({
      listProviders: () => [provider({ name: "uniswap" })],
      now: clock.now,
    });
    const res = handler({ traceId: TRACE });
    expect(res.status).toBe("success");
    expect(res.traceId).toBe(TRACE);
    expect(res.provider.name).toBe("discovery");
    expect(res.data.capabilities).toHaveLength(1);
    expect(res.data.cacheTtlSeconds).toBe(30);
    expect(res.data.generatedAt).toBe("2026-05-22T00:00:00.000Z");
  });

  it("honours custom cacheTtlSeconds", () => {
    const clock = fixedTime();
    const handler = createDiscoveryHandler({
      listProviders: () => [],
      cacheTtlSeconds: 5,
      now: clock.now,
    });
    const res = handler({ traceId: TRACE });
    expect(res.data.cacheTtlSeconds).toBe(5);
  });
});

describe("discovery.handler — caching", () => {
  it("uses cached snapshot within TTL", () => {
    const clock = fixedTime();
    const listProviders = vi.fn(() => [provider({ name: "uniswap" })]);
    const handler = createDiscoveryHandler({
      listProviders,
      cacheTtlSeconds: 30,
      now: clock.now,
    });

    handler({ traceId: TRACE });
    clock.advance(10_000); // 10s later, within TTL
    handler({ traceId: TRACE });

    expect(listProviders).toHaveBeenCalledOnce();
  });

  it("rebuilds after TTL expires", () => {
    const clock = fixedTime();
    const listProviders = vi.fn(() => [provider({ name: "uniswap" })]);
    const handler = createDiscoveryHandler({
      listProviders,
      cacheTtlSeconds: 30,
      now: clock.now,
    });

    handler({ traceId: TRACE });
    clock.advance(31_000); // past TTL
    handler({ traceId: TRACE });

    expect(listProviders).toHaveBeenCalledTimes(2);
  });

  it("force: true bypasses cache", () => {
    const clock = fixedTime();
    const listProviders = vi.fn(() => [provider({ name: "uniswap" })]);
    const handler = createDiscoveryHandler({
      listProviders,
      cacheTtlSeconds: 30,
      now: clock.now,
    });

    handler({ traceId: TRACE });
    handler({ traceId: TRACE, force: true });

    expect(listProviders).toHaveBeenCalledTimes(2);
  });

  it("invalidate() drops the cached snapshot", () => {
    const clock = fixedTime();
    const listProviders = vi.fn(() => []);
    const handler = createDiscoveryHandler({
      listProviders,
      now: clock.now,
    });

    handler({ traceId: TRACE });
    handler.invalidate();
    handler({ traceId: TRACE });

    expect(listProviders).toHaveBeenCalledTimes(2);
  });
});

describe("discovery.handler — health overlay", () => {
  it("includes health from snapshotHealth", () => {
    const clock = fixedTime();
    const handler = createDiscoveryHandler({
      listProviders: () => [
        provider({ name: "uniswap", supportedChains: [1] }),
        provider({ name: "aerodrome", capability: "swap", supportedChains: [8453] }),
      ],
      snapshotHealth: () =>
        new Map<string, ProviderHealth>([
          [
            "aerodrome",
            { healthy: false, reason: "rate-limit", latencyMs: 100, checkedAt: "x" },
          ],
        ]),
      now: clock.now,
    });
    const res = handler({ traceId: TRACE });
    const swap = res.data.capabilities[0];
    const aero = swap?.byChain[8453]?.[0];
    expect(aero?.healthy).toBe(false);
    expect(aero?.lastError).toBe("rate-limit");
  });

  it("defaults to healthy when no snapshot", () => {
    const handler = createDiscoveryHandler({
      listProviders: () => [provider({ name: "uniswap" })],
    });
    const res = handler({ traceId: TRACE });
    expect(res.data.capabilities[0]?.byChain[1]?.[0]?.healthy).toBe(true);
  });
});

describe("discovery.handler — envelope details", () => {
  it("reports latencyMs ≥ 0", () => {
    const handler = createDiscoveryHandler({ listProviders: () => [] });
    const res = handler({ traceId: TRACE });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates traceId verbatim", () => {
    const handler = createDiscoveryHandler({ listProviders: () => [] });
    const res = handler({ traceId: "my-custom-trace" });
    expect(res.traceId).toBe("my-custom-trace");
  });
});
