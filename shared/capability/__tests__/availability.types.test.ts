import { describe, it, expect } from "vitest";

import { buildAvailabilityMap } from "../availability.types";
import type { ICapabilityProvider, ProviderHealth } from "../provider.types";

function fakeProvider(input: {
  name: string;
  capability:
    | "swap"
    | "lending"
    | "staking"
    | "liquidity"
    | "bridge"
    | "automation"
    | "auth";
  supportedChains: number[];
  enabled?: boolean;
}): ICapabilityProvider {
  return {
    name: input.name,
    metadata: {
      name: input.name,
      capability: input.capability,
      supportedChains: input.supportedChains,
      version: "1.0.0",
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  };
}

const FIXED_NOW = () => new Date("2026-05-22T14:00:00.000Z");

describe("buildAvailabilityMap — basics", () => {
  it("returns empty capabilities when no providers", () => {
    const map = buildAvailabilityMap({ providers: [], now: FIXED_NOW });
    expect(map.capabilities).toEqual([]);
    expect(map.generatedAt).toBe("2026-05-22T14:00:00.000Z");
    expect(map.cacheTtlSeconds).toBe(30);
  });

  it("uses cacheTtlSeconds when provided", () => {
    const map = buildAvailabilityMap({
      providers: [],
      cacheTtlSeconds: 60,
      now: FIXED_NOW,
    });
    expect(map.cacheTtlSeconds).toBe(60);
  });
});

describe("buildAvailabilityMap — grouping", () => {
  const providers: ICapabilityProvider[] = [
    fakeProvider({ name: "uniswap", capability: "swap", supportedChains: [1, 8453] }),
    fakeProvider({ name: "aerodrome", capability: "swap", supportedChains: [8453] }),
    fakeProvider({ name: "lido", capability: "staking", supportedChains: [1] }),
  ];

  it("groups providers by capability and chain", () => {
    const map = buildAvailabilityMap({ providers, now: FIXED_NOW });
    expect(map.capabilities).toHaveLength(2);

    const staking = map.capabilities.find((c) => c.capability === "staking");
    expect(staking?.byChain[1]).toHaveLength(1);
    expect(staking?.byChain[1]?.[0]?.provider).toBe("lido");

    const swap = map.capabilities.find((c) => c.capability === "swap");
    expect(Object.keys(swap?.byChain ?? {})).toEqual(["1", "8453"]);
    expect(swap?.byChain[1]?.map((p) => p.provider)).toEqual(["uniswap"]);
    expect(swap?.byChain[8453]?.map((p) => p.provider).sort()).toEqual([
      "aerodrome",
      "uniswap",
    ]);
  });

  it("sorts capabilities alphabetically", () => {
    const map = buildAvailabilityMap({ providers, now: FIXED_NOW });
    expect(map.capabilities.map((c) => c.capability)).toEqual(["staking", "swap"]);
  });

  it("sorts providers within a chain alphabetically", () => {
    const map = buildAvailabilityMap({ providers, now: FIXED_NOW });
    const swap = map.capabilities.find((c) => c.capability === "swap");
    expect(swap?.byChain[8453]?.map((p) => p.provider)).toEqual([
      "aerodrome",
      "uniswap",
    ]);
  });

  it("sorts chain ids numerically (not lexicographically)", () => {
    const p = [
      fakeProvider({ name: "x", capability: "swap", supportedChains: [100, 1, 8453] }),
    ];
    const map = buildAvailabilityMap({ providers: p, now: FIXED_NOW });
    const swap = map.capabilities[0];
    expect(Object.keys(swap?.byChain ?? {})).toEqual(["1", "100", "8453"]);
  });
});

describe("buildAvailabilityMap — enabled flag", () => {
  it("skips providers with enabled: false (stubs)", () => {
    const map = buildAvailabilityMap({
      providers: [
        fakeProvider({ name: "lido", capability: "staking", supportedChains: [1] }),
        fakeProvider({
          name: "base-staking-stub",
          capability: "staking",
          supportedChains: [8453],
          enabled: false,
        }),
      ],
      now: FIXED_NOW,
    });
    const staking = map.capabilities[0];
    expect(Object.keys(staking?.byChain ?? {})).toEqual(["1"]);
    expect(staking?.byChain[1]?.map((p) => p.provider)).toEqual(["lido"]);
  });

  it("includes providers with enabled: true explicitly", () => {
    const map = buildAvailabilityMap({
      providers: [
        fakeProvider({
          name: "lido",
          capability: "staking",
          supportedChains: [1],
          enabled: true,
        }),
      ],
      now: FIXED_NOW,
    });
    expect(map.capabilities[0]?.byChain[1]?.[0]?.provider).toBe("lido");
  });
});

describe("buildAvailabilityMap — health overlay", () => {
  const providers = [
    fakeProvider({ name: "uniswap", capability: "swap", supportedChains: [1] }),
    fakeProvider({ name: "aerodrome", capability: "swap", supportedChains: [8453] }),
  ];

  it("defaults to healthy when no health snapshot provided", () => {
    const map = buildAvailabilityMap({ providers, now: FIXED_NOW });
    const swap = map.capabilities[0];
    for (const chain of Object.values(swap?.byChain ?? {})) {
      for (const p of chain) {
        expect(p.healthy).toBe(true);
        expect(p.latencyP95Ms).toBeUndefined();
        expect(p.lastError).toBeUndefined();
      }
    }
  });

  it("applies health from Map", () => {
    const health = new Map<string, ProviderHealth>([
      ["uniswap", { healthy: true, latencyMs: 240, checkedAt: "2026-05-22T13:59:30Z" }],
      [
        "aerodrome",
        {
          healthy: false,
          latencyMs: 5000,
          reason: "rate-limit",
          checkedAt: "2026-05-22T13:59:45Z",
        },
      ],
    ]);
    const map = buildAvailabilityMap({ providers, healthByName: health, now: FIXED_NOW });
    const swap = map.capabilities[0];
    const uni = swap?.byChain[1]?.[0];
    const aero = swap?.byChain[8453]?.[0];
    expect(uni?.healthy).toBe(true);
    expect(uni?.latencyP95Ms).toBe(240);
    expect(uni?.lastError).toBeUndefined();
    expect(aero?.healthy).toBe(false);
    expect(aero?.lastError).toBe("rate-limit");
    expect(aero?.lastCheckedAt).toBe("2026-05-22T13:59:45Z");
  });

  it("applies health from plain object", () => {
    const map = buildAvailabilityMap({
      providers,
      healthByName: {
        uniswap: { healthy: false, reason: "down", checkedAt: "2026-05-22T13:00Z" },
      },
      now: FIXED_NOW,
    });
    const uni = map.capabilities[0]?.byChain[1]?.[0];
    expect(uni?.healthy).toBe(false);
    expect(uni?.lastError).toBe("down");
  });

  it("truncates long error reasons to 120 chars", () => {
    const longReason = "x".repeat(500);
    const map = buildAvailabilityMap({
      providers,
      healthByName: { uniswap: { healthy: false, reason: longReason, checkedAt: "now" } },
      now: FIXED_NOW,
    });
    const uni = map.capabilities[0]?.byChain[1]?.[0];
    expect(uni?.lastError).toHaveLength(120);
  });
});

describe("buildAvailabilityMap — same provider on multiple chains", () => {
  it("repeats the provider entry per supported chain", () => {
    const map = buildAvailabilityMap({
      providers: [
        fakeProvider({
          name: "thirdweb-bridge",
          capability: "bridge",
          supportedChains: [1, 8453, 43114],
        }),
      ],
      healthByName: {
        "thirdweb-bridge": { healthy: true, latencyMs: 80, checkedAt: "now" },
      },
      now: FIXED_NOW,
    });
    const bridge = map.capabilities[0];
    expect(Object.keys(bridge?.byChain ?? {})).toHaveLength(3);
    for (const chainList of Object.values(bridge?.byChain ?? {})) {
      expect(chainList).toHaveLength(1);
      expect(chainList[0]?.provider).toBe("thirdweb-bridge");
      expect(chainList[0]?.latencyP95Ms).toBe(80);
    }
  });
});
