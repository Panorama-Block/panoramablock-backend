import { describe, it, expect, vi } from "vitest";

import {
  ChainAssetPriorityPolicy,
  fallbackInvoke,
  type PolicyContext,
} from "../policy";
import { CapabilityError, ErrorCategory } from "../errors";
import type { ICapabilityProvider } from "../provider.types";

interface SwapP extends ICapabilityProvider {
  tag: string;
}

function provider(name: string): SwapP {
  return {
    name,
    metadata: {
      name,
      capability: "swap",
      supportedChains: [1, 8453],
      version: "1.0.0",
    },
    tag: name,
  };
}

const uniswap = provider("uniswap");
const aerodrome = provider("aerodrome");
const thirdweb = provider("thirdweb");
const utapi = provider("uniswap-trading-api");

const allProviders = [uniswap, aerodrome, thirdweb, utapi];

const baseSameChainCtx: PolicyContext = { chainId: 8453 };
const ethSameChainCtx: PolicyContext = { chainId: 1 };
const crossChainCtx: PolicyContext = { chainId: 1, destinationChainId: 137 };

describe("ChainAssetPriorityPolicy — flat per-chain config", () => {
  const policy = new ChainAssetPriorityPolicy({
    "8453": ["aerodrome", "uniswap-trading-api", "uniswap", "thirdweb"],
    "1": ["uniswap-trading-api", "uniswap", "thirdweb"],
    "default-cross-chain": ["thirdweb", "uniswap-trading-api", "uniswap"],
  });

  it("ranks per config for Base same-chain", () => {
    const r = policy.rank(allProviders, baseSameChainCtx).map((p) => p.name);
    expect(r).toEqual(["aerodrome", "uniswap-trading-api", "uniswap", "thirdweb"]);
  });

  it("ranks per config for Eth same-chain (aerodrome unmentioned → last, stable)", () => {
    const r = policy.rank(allProviders, ethSameChainCtx).map((p) => p.name);
    expect(r).toEqual(["uniswap-trading-api", "uniswap", "thirdweb", "aerodrome"]);
  });

  it("uses default-cross-chain when destinationChainId differs", () => {
    const r = policy.rank(allProviders, crossChainCtx).map((p) => p.name);
    expect(r).toEqual(["thirdweb", "uniswap-trading-api", "uniswap", "aerodrome"]);
  });

  it("returns providers unchanged when chain not in config", () => {
    const r = policy.rank(allProviders, { chainId: 137 }).map((p) => p.name);
    expect(r).toEqual(["uniswap", "aerodrome", "thirdweb", "uniswap-trading-api"]);
  });

  it("does not mutate the input array", () => {
    const input = [...allProviders];
    policy.rank(input, baseSameChainCtx);
    expect(input.map((p) => p.name)).toEqual([
      "uniswap",
      "aerodrome",
      "thirdweb",
      "uniswap-trading-api",
    ]);
  });
});

describe("ChainAssetPriorityPolicy — per-asset overrides", () => {
  const policy = new ChainAssetPriorityPolicy({
    "8453": {
      default: ["aerodrome", "uniswap"],
      "by-asset": {
        USDC: ["uniswap", "aerodrome"],
      },
    },
  });

  it("uses asset-specific order when asset matches", () => {
    const r = policy
      .rank([uniswap, aerodrome], { chainId: 8453, asset: "USDC" })
      .map((p) => p.name);
    expect(r).toEqual(["uniswap", "aerodrome"]);
  });

  it("falls back to default when asset not in overrides", () => {
    const r = policy
      .rank([uniswap, aerodrome], { chainId: 8453, asset: "DAI" })
      .map((p) => p.name);
    expect(r).toEqual(["aerodrome", "uniswap"]);
  });

  it("falls back to default when asset not provided", () => {
    const r = policy
      .rank([uniswap, aerodrome], { chainId: 8453 })
      .map((p) => p.name);
    expect(r).toEqual(["aerodrome", "uniswap"]);
  });
});

describe("ChainAssetPriorityPolicy — guards", () => {
  it("throws on missing config", () => {
    // @ts-expect-error — intentional
    expect(() => new ChainAssetPriorityPolicy(null)).toThrowError(CapabilityError);
  });
});

describe("fallbackInvoke — happy path", () => {
  it("returns first supporting provider's result", async () => {
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async (p) => p.name === "aerodrome",
      invoke: async (p) => `swap via ${p.name}`,
      capability: "swap",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toBe("swap via aerodrome");
      expect(outcome.provider).toBe(aerodrome);
      expect(outcome.attempts).toEqual([]);
    }
  });
});

describe("fallbackInvoke — supportsRoute skips", () => {
  it("records skip reason and tries next", async () => {
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async (p) => p.name !== "aerodrome",
      invoke: async (p) => `swap via ${p.name}`,
      capability: "swap",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toBe("swap via uniswap");
      expect(outcome.attempts).toEqual([{ provider: "aerodrome", reason: "route unsupported" }]);
    }
  });

  it("supportsRoute throwing is treated as 'route unsupported by this provider'", async () => {
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async (p) => {
        if (p.name === "aerodrome") throw new Error("rpc down");
        return true;
      },
      invoke: async () => "ok",
      capability: "swap",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.attempts[0]?.reason).toMatch(/supportsRoute threw/);
    }
  });
});

describe("fallbackInvoke — invoke errors", () => {
  it("falls back on generic error and keeps trying", async () => {
    const invoke = vi.fn(async (p: SwapP) => {
      if (p.name === "aerodrome") throw new Error("liquidity gone");
      return `ok ${p.name}`;
    });
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async () => true,
      invoke,
      capability: "swap",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toBe("ok uniswap");
      expect(outcome.attempts[0]).toEqual({ provider: "aerodrome", reason: "liquidity gone" });
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("rethrows VALIDATION errors immediately (no fallback)", async () => {
    const err = CapabilityError.validation({
      capability: "swap",
      message: "amount must be > 0",
    });
    const invoke = vi.fn(async () => {
      throw err;
    });
    await expect(
      fallbackInvoke({
        ranked: [aerodrome, uniswap],
        supportsRoute: async () => true,
        invoke,
        capability: "swap",
      })
    ).rejects.toThrowError(err);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rethrows UNSUPPORTED_ROUTE immediately", async () => {
    const err = CapabilityError.unsupportedRoute({
      capability: "swap",
      chainId: 1,
      attempted: ["aerodrome"],
    });
    await expect(
      fallbackInvoke({
        ranked: [aerodrome, uniswap],
        supportsRoute: async () => true,
        invoke: async () => {
          throw err;
        },
        capability: "swap",
      })
    ).rejects.toBe(err);
  });

  it("custom shouldFallback overrides default", async () => {
    const err = CapabilityError.validation({
      capability: "swap",
      message: "x",
    });
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async () => true,
      invoke: async (p) => {
        if (p.name === "aerodrome") throw err;
        return "ok uniswap";
      },
      shouldFallback: () => "fallback", // override: never rethrow
      capability: "swap",
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("fallbackInvoke — total failure", () => {
  it("returns failure with allProvidersFailed error", async () => {
    const outcome = await fallbackInvoke({
      ranked: [aerodrome, uniswap],
      supportsRoute: async () => false,
      invoke: async () => "never",
      capability: "swap",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(CapabilityError);
      expect(outcome.error.code).toBe("CAPABILITY_SWAP_ALL_PROVIDERS_FAILED");
      expect(outcome.error.category).toBe(ErrorCategory.UNAVAILABLE);
      expect(outcome.attempts).toHaveLength(2);
    }
  });

  it("returns failure when ranked is empty", async () => {
    const outcome = await fallbackInvoke({
      ranked: [],
      supportsRoute: async () => true,
      invoke: async () => "never",
      capability: "swap",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.attempts).toEqual([]);
      expect(outcome.error.details).toMatchObject({ capability: "swap", attempts: [] });
    }
  });
});
