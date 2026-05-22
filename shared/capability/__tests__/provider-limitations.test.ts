import { describe, it, expect } from "vitest";

import {
  applyLimitations,
  compareDecimalStrings,
  type ProviderLimitations,
} from "../provider-limitations";
import { CapabilityError, ErrorCategory } from "../errors";

describe("compareDecimalStrings", () => {
  it("returns 0 for equal", () => {
    expect(compareDecimalStrings("100", "100")).toBe(0);
    expect(compareDecimalStrings("0", "0")).toBe(0);
    expect(compareDecimalStrings("00100", "100")).toBe(0);
  });

  it("returns -1 / 1 for less / greater (different lengths)", () => {
    expect(compareDecimalStrings("99", "100")).toBe(-1);
    expect(compareDecimalStrings("1000", "999")).toBe(1);
  });

  it("returns -1 / 1 for same-length comparison", () => {
    expect(compareDecimalStrings("123", "124")).toBe(-1);
    expect(compareDecimalStrings("999", "123")).toBe(1);
  });

  it("trims whitespace and leading zeros", () => {
    expect(compareDecimalStrings("  100  ", "100")).toBe(0);
    expect(compareDecimalStrings("0000050", "50")).toBe(0);
  });

  it("throws on invalid input", () => {
    expect(() => compareDecimalStrings("12.5", "1")).toThrow();
    expect(() => compareDecimalStrings("-1", "0")).toThrow();
    expect(() => compareDecimalStrings("abc", "1")).toThrow();
  });

  it("handles huge values (wei-scale)", () => {
    const max = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // uint256 max
    expect(compareDecimalStrings(max, "1")).toBe(1);
    expect(compareDecimalStrings(max, max)).toBe(0);
  });
});

describe("applyLimitations — blockedTokens", () => {
  it("rejects when asset is in blocked list", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: { blockedTokens: ["USDT"] },
      asset: "USDT",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(CapabilityError);
      expect(r.error.category).toBe(ErrorCategory.VALIDATION);
      expect(r.error.details).toMatchObject({
        errors: [{ field: "asset", reason: "blocked", value: "USDT" }],
      });
    }
  });

  it("allows when asset not in blocked list", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: { blockedTokens: ["USDT"] },
      asset: "USDC",
    });
    expect(r.ok).toBe(true);
  });
});

describe("applyLimitations — blockedChains", () => {
  it("rejects when chain is blocked", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "aerodrome",
      limitations: { blockedChains: [1] },
      chainId: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.category).toBe(ErrorCategory.VALIDATION);
    }
  });
});

describe("applyLimitations — amount range", () => {
  const lim: ProviderLimitations = {
    minAmountByAsset: { USDC: "1000000" }, // 1 USDC (6 decimals)
    maxAmountByAsset: { USDC: "100000000000" }, // 100,000 USDC
  };

  it("rejects below min", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: lim,
      asset: "USDC",
      amount: "999999",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.details).toMatchObject({
        errors: [{ field: "amount", reason: "below-min", value: "999999", min: "1000000" }],
      });
    }
  });

  it("rejects above max", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: lim,
      asset: "USDC",
      amount: "100000000001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.details).toMatchObject({
        errors: [{ field: "amount", reason: "above-max" }],
      });
    }
  });

  it("accepts within range (inclusive at min, inclusive at max)", () => {
    expect(
      applyLimitations({
        capability: "swap",
        provider: "uniswap",
        limitations: lim,
        asset: "USDC",
        amount: "1000000",
      }).ok
    ).toBe(true);
    expect(
      applyLimitations({
        capability: "swap",
        provider: "uniswap",
        limitations: lim,
        asset: "USDC",
        amount: "100000000000",
      }).ok
    ).toBe(true);
  });

  it("does not check amount when asset key missing in maps", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: lim,
      asset: "DAI", // no entry
      amount: "0",
    });
    expect(r.ok).toBe(true);
  });
});

describe("applyLimitations — dailyVolumeLimit", () => {
  it("rate-limits when today's volume meets or exceeds the cap", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: { dailyVolumeLimitUsd: 10000 },
      todayVolumeUsd: 10000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.category).toBe(ErrorCategory.RATE_LIMITED);
      expect(r.error.code).toBe("CAPABILITY_SWAP_RATE_LIMITED");
    }
  });

  it("allows below the cap", () => {
    expect(
      applyLimitations({
        capability: "swap",
        provider: "uniswap",
        limitations: { dailyVolumeLimitUsd: 10000 },
        todayVolumeUsd: 9999.99,
      }).ok
    ).toBe(true);
  });
});

describe("applyLimitations — composition", () => {
  it("returns the first failing rule (asset blocked beats amount check)", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: {
        blockedTokens: ["USDT"],
        minAmountByAsset: { USDT: "1000000" },
      },
      asset: "USDT",
      amount: "999999", // would also fail min, but blockedTokens fires first
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/does not support asset "USDT"/);
    }
  });

  it("passes when no limitation fires", () => {
    const r = applyLimitations({
      capability: "swap",
      provider: "uniswap",
      limitations: {},
    });
    expect(r.ok).toBe(true);
  });
});
