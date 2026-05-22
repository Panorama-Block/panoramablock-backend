import { describe, it, expect, vi } from "vitest";

import { ProviderRegistry } from "../registry";
import { CapabilityError } from "../errors";
import type { ICapabilityProvider } from "../provider.types";
import type { HealthOracle } from "../registry.types";

interface SwapProvider extends ICapabilityProvider {
  swap(): string;
}

function provider(input: {
  name: string;
  capability?: "swap" | "lending" | "staking";
  supportedChains?: number[];
  enabled?: boolean;
}): SwapProvider {
  return {
    name: input.name,
    metadata: {
      name: input.name,
      capability: input.capability ?? "swap",
      supportedChains: input.supportedChains ?? [1],
      version: "1.0.0",
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
    swap: () => input.name,
  };
}

describe("ProviderRegistry — register", () => {
  it("registers a provider and lists it back", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    expect(r.size()).toBe(1);
    expect(r.getByName("uniswap")?.swap()).toBe("uniswap");
  });

  it("throws CapabilityError on duplicate name", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    expect(() => r.register(provider({ name: "uniswap" }))).toThrowError(CapabilityError);
    try {
      r.register(provider({ name: "uniswap" }));
    } catch (e) {
      const err = e as CapabilityError;
      expect(err.code).toBe("CAPABILITY_REGISTRY_DUPLICATE");
      expect(err.httpStatus).toBe(400);
    }
  });

  it("throws on invalid metadata (rejected by validateProviderMetadata)", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const bad: SwapProvider = {
      name: "BadCase",
      metadata: {
        name: "BadCase", // uppercase, will fail
        capability: "swap",
        supportedChains: [1],
        version: "1.0.0",
      },
      swap: () => "x",
    };
    expect(() => r.register(bad)).toThrowError(CapabilityError);
  });

  it("throws when provider.name and metadata.name disagree", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const mismatched: SwapProvider = {
      name: "uniswap",
      metadata: {
        name: "different-name",
        capability: "swap",
        supportedChains: [1],
        version: "1.0.0",
      },
      swap: () => "x",
    };
    expect(() => r.register(mismatched)).toThrowError(/name/);
  });
});

describe("ProviderRegistry — unregister", () => {
  it("removes an existing provider and returns true", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    expect(r.unregister("uniswap")).toBe(true);
    expect(r.size()).toBe(0);
  });

  it("returns false for missing provider", () => {
    const r = new ProviderRegistry<SwapProvider>();
    expect(r.unregister("ghost")).toBe(false);
  });
});

describe("ProviderRegistry — listAll filters", () => {
  function setup() {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap", capability: "swap", supportedChains: [1, 8453] }));
    r.register(provider({ name: "aerodrome", capability: "swap", supportedChains: [8453] }));
    r.register(
      provider({ name: "benqi", capability: "lending", supportedChains: [43114] }) as SwapProvider
    );
    r.register(
      provider({
        name: "base-staking-stub",
        capability: "staking",
        supportedChains: [8453],
        enabled: false,
      }) as SwapProvider
    );
    return r;
  }

  it("no filter — returns all non-disabled providers (3, stub excluded)", () => {
    const r = setup();
    expect(r.listAll().map((p) => p.name).sort()).toEqual(["aerodrome", "benqi", "uniswap"]);
  });

  it("includeDisabled: true also returns stubs", () => {
    const r = setup();
    expect(r.listAll({ includeDisabled: true }).length).toBe(4);
  });

  it("capability filter narrows", () => {
    const r = setup();
    expect(r.listAll({ capability: "swap" }).map((p) => p.name).sort()).toEqual([
      "aerodrome",
      "uniswap",
    ]);
    expect(r.listAll({ capability: "lending" }).map((p) => p.name)).toEqual(["benqi"]);
  });

  it("healthy filter consults the oracle", () => {
    const r = setup();
    r.attachHealthOracle({ isHealthy: (n) => n !== "aerodrome" });
    expect(r.listAll({ healthy: true }).map((p) => p.name).sort()).toEqual([
      "benqi",
      "uniswap",
    ]);
    expect(r.listAll({ healthy: false }).map((p) => p.name)).toEqual(["aerodrome"]);
  });
});

describe("ProviderRegistry — listByChain", () => {
  function setup() {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap", capability: "swap", supportedChains: [1, 8453] }));
    r.register(provider({ name: "aerodrome", capability: "swap", supportedChains: [8453] }));
    r.register(
      provider({ name: "lido", capability: "staking", supportedChains: [1] }) as SwapProvider
    );
    return r;
  }

  it("returns providers that include the chain id", () => {
    const r = setup();
    expect(r.listByChain(8453).map((p) => p.name).sort()).toEqual([
      "aerodrome",
      "uniswap",
    ]);
    expect(r.listByChain(1).map((p) => p.name).sort()).toEqual(["lido", "uniswap"]);
  });

  it("returns empty for unsupported chain", () => {
    const r = setup();
    expect(r.listByChain(137)).toEqual([]);
  });

  it("filters by capability when requested", () => {
    const r = setup();
    expect(r.listByChain(1, { capability: "staking" }).map((p) => p.name)).toEqual(["lido"]);
    expect(r.listByChain(1, { capability: "swap" }).map((p) => p.name)).toEqual(["uniswap"]);
  });

  it("excludes unhealthy by default", () => {
    const r = setup();
    r.attachHealthOracle({ isHealthy: (n) => n !== "aerodrome" });
    expect(r.listByChain(8453).map((p) => p.name)).toEqual(["uniswap"]);
  });

  it("explicit healthy: undefined includes unhealthy", () => {
    const r = setup();
    r.attachHealthOracle({ isHealthy: (n) => n !== "aerodrome" });
    expect(r.listByChain(8453, { healthy: undefined }).map((p) => p.name).sort()).toEqual([
      "aerodrome",
      "uniswap",
    ]);
  });

  it("excludes disabled stubs by default", () => {
    const r = setup();
    r.register(
      provider({
        name: "base-staking-stub",
        capability: "staking",
        supportedChains: [8453],
        enabled: false,
      }) as SwapProvider
    );
    expect(r.listByChain(8453, { capability: "staking" })).toEqual([]);
    expect(
      r.listByChain(8453, { capability: "staking", includeDisabled: true }).map((p) => p.name)
    ).toEqual(["base-staking-stub"]);
  });
});

describe("ProviderRegistry — health oracle attach/detach", () => {
  it("defaults to all-healthy when no oracle attached", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    expect(r.listByChain(1).map((p) => p.name)).toEqual(["uniswap"]);
  });

  it("falls back to all-healthy when detached (oracle = undefined)", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    const oracle: HealthOracle = { isHealthy: () => false };
    r.attachHealthOracle(oracle);
    expect(r.listByChain(1)).toEqual([]);
    r.attachHealthOracle(undefined);
    expect(r.listByChain(1).map((p) => p.name)).toEqual(["uniswap"]);
  });
});

describe("ProviderRegistry — subscribe", () => {
  it("notifies listeners on register/unregister", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const listener = vi.fn();
    const unsub = r.subscribe(listener);

    const p = provider({ name: "uniswap" });
    r.register(p);
    r.unregister("uniswap");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { kind: "registered", provider: p });
    expect(listener).toHaveBeenNthCalledWith(2, { kind: "unregistered", providerName: "uniswap" });

    unsub();
    r.register(provider({ name: "thirdweb" }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates listener errors — registry keeps emitting to other listeners", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const bad = vi.fn(() => {
      throw new Error("listener boom");
    });
    const good = vi.fn();
    r.subscribe(bad);
    r.subscribe(good);
    expect(() => r.register(provider({ name: "uniswap" }))).not.toThrow();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});

describe("ProviderRegistry — metadataSnapshot + clear", () => {
  it("snapshot returns all metadata", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    r.register(provider({ name: "aerodrome", supportedChains: [8453] }));
    const snap = r.metadataSnapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map((m) => m.name).sort()).toEqual(["aerodrome", "uniswap"]);
  });

  it("clear empties the registry and emits unregistered for each", () => {
    const r = new ProviderRegistry<SwapProvider>();
    r.register(provider({ name: "uniswap" }));
    r.register(provider({ name: "aerodrome" }));
    const listener = vi.fn();
    r.subscribe(listener);
    r.clear();
    expect(r.size()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
