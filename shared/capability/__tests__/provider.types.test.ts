import { describe, it, expect } from "vitest";

import {
  CAPABILITY_SLUGS,
  isCapabilitySlug,
  validateProviderMetadata,
  type ProviderMetadata,
  type ICapabilityProvider,
} from "../provider.types";

describe("CapabilitySlug", () => {
  it("CAPABILITY_SLUGS is non-empty and unique", () => {
    expect(CAPABILITY_SLUGS.length).toBeGreaterThan(0);
    expect(new Set(CAPABILITY_SLUGS).size).toBe(CAPABILITY_SLUGS.length);
  });

  it("isCapabilitySlug accepts every slug in the closed set", () => {
    for (const slug of CAPABILITY_SLUGS) {
      expect(isCapabilitySlug(slug)).toBe(true);
    }
  });

  it("isCapabilitySlug rejects unknown values", () => {
    expect(isCapabilitySlug("derivatives")).toBe(false);
    expect(isCapabilitySlug("Swap")).toBe(false); // case-sensitive
    expect(isCapabilitySlug("")).toBe(false);
    expect(isCapabilitySlug(42)).toBe(false);
    expect(isCapabilitySlug(null)).toBe(false);
    expect(isCapabilitySlug(undefined)).toBe(false);
  });
});

describe("validateProviderMetadata — happy path", () => {
  it("accepts a complete valid metadata", () => {
    const m: ProviderMetadata = {
      name: "lido",
      capability: "staking",
      supportedChains: [1],
      features: ["stETH", "wstETH"],
      version: "1.0.0",
      enabled: true,
    };
    expect(validateProviderMetadata(m)).toEqual({ ok: true });
  });

  it("accepts minimum required fields (features and enabled optional)", () => {
    const m: ProviderMetadata = {
      name: "uniswap",
      capability: "swap",
      supportedChains: [1, 8453],
      version: "0.1.0",
    };
    expect(validateProviderMetadata(m)).toEqual({ ok: true });
  });

  it("accepts hyphenated names", () => {
    const m: ProviderMetadata = {
      name: "uniswap-trading-api",
      capability: "swap",
      supportedChains: [1],
      version: "1.0.0",
    };
    expect(validateProviderMetadata(m)).toEqual({ ok: true });
  });
});

describe("validateProviderMetadata — name rules", () => {
  function meta(name: unknown): unknown {
    return {
      name,
      capability: "swap",
      supportedChains: [1],
      version: "1.0.0",
    };
  }

  it("rejects empty name", () => {
    const r = validateProviderMetadata(meta(""));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/name must be a non-empty/);
  });

  it("rejects uppercase name", () => {
    const r = validateProviderMetadata(meta("Uniswap"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/lowercase/);
  });

  it("rejects name starting with digit", () => {
    const r = validateProviderMetadata(meta("1inch"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/must match/);
  });

  it("rejects name with underscore", () => {
    const r = validateProviderMetadata(meta("uni_swap"));
    expect(r.ok).toBe(false);
  });

  it("rejects non-string name", () => {
    const r = validateProviderMetadata(meta(42));
    expect(r.ok).toBe(false);
  });
});

describe("validateProviderMetadata — capability rules", () => {
  it("rejects unknown capability slug", () => {
    const r = validateProviderMetadata({
      name: "x",
      capability: "derivatives",
      supportedChains: [1],
      version: "1.0.0",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/capability must be one of/);
  });

  it("rejects missing capability", () => {
    const r = validateProviderMetadata({
      name: "x",
      supportedChains: [1],
      version: "1.0.0",
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateProviderMetadata — supportedChains rules", () => {
  function meta(supportedChains: unknown): unknown {
    return {
      name: "x",
      capability: "swap",
      supportedChains,
      version: "1.0.0",
    };
  }

  it("rejects non-array", () => {
    expect(validateProviderMetadata(meta("8453")).ok).toBe(false);
  });

  it("rejects empty array", () => {
    expect(validateProviderMetadata(meta([])).ok).toBe(false);
  });

  it("rejects array with zero or negative", () => {
    const r = validateProviderMetadata(meta([0, -1]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/non-positive-integer/);
  });

  it("rejects floats", () => {
    const r = validateProviderMetadata(meta([8453.5]));
    expect(r.ok).toBe(false);
  });
});

describe("validateProviderMetadata — version rules", () => {
  function meta(version: unknown): unknown {
    return {
      name: "x",
      capability: "swap",
      supportedChains: [1],
      version,
    };
  }

  it("accepts plain SemVer", () => {
    expect(validateProviderMetadata(meta("1.0.0")).ok).toBe(true);
  });

  it("accepts SemVer with pre-release", () => {
    expect(validateProviderMetadata(meta("1.0.0-beta.1")).ok).toBe(true);
  });

  it("rejects non-SemVer", () => {
    expect(validateProviderMetadata(meta("v1")).ok).toBe(false);
    expect(validateProviderMetadata(meta(1)).ok).toBe(false);
  });
});

describe("validateProviderMetadata — top-level shape", () => {
  it("rejects null", () => {
    expect(validateProviderMetadata(null).ok).toBe(false);
  });

  it("rejects non-object", () => {
    expect(validateProviderMetadata("metadata").ok).toBe(false);
    expect(validateProviderMetadata(42).ok).toBe(false);
  });

  it("collects multiple errors", () => {
    const r = validateProviderMetadata({
      name: "Bad Name",
      capability: "unknown",
      supportedChains: [],
      version: "not-semver",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("ICapabilityProvider — type shape (compile-only)", () => {
  it("accepts a minimal provider implementation", () => {
    class FakeProvider implements ICapabilityProvider {
      readonly name = "fake";
      readonly metadata: ProviderMetadata = {
        name: "fake",
        capability: "swap",
        supportedChains: [1],
        version: "1.0.0",
      };
    }
    const p = new FakeProvider();
    expect(p.name).toBe("fake");
    expect(p.metadata.capability).toBe("swap");
  });

  it("accepts a provider with healthCheck", async () => {
    class FakeProvider implements ICapabilityProvider {
      readonly name = "fake";
      readonly metadata: ProviderMetadata = {
        name: "fake",
        capability: "swap",
        supportedChains: [1],
        version: "1.0.0",
      };
      async healthCheck() {
        return { healthy: true, latencyMs: 12, checkedAt: new Date().toISOString() };
      }
    }
    const p = new FakeProvider();
    const h = await p.healthCheck!();
    expect(h.healthy).toBe(true);
    expect(typeof h.latencyMs).toBe("number");
  });
});
