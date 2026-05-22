import { describe, it, expect } from "vitest";

import { CapabilityError, ErrorCategory, categoryToHttpStatus } from "../errors";

describe("ErrorCategory → httpStatus map", () => {
  it("maps every category to a known status", () => {
    const expected: Record<ErrorCategory, number> = {
      [ErrorCategory.VALIDATION]: 400,
      [ErrorCategory.UNSUPPORTED_ROUTE]: 404,
      [ErrorCategory.RATE_LIMITED]: 429,
      [ErrorCategory.INSUFFICIENT_LIQUIDITY]: 422,
      [ErrorCategory.INTERNAL]: 500,
      [ErrorCategory.PROVIDER_FAILURE]: 502,
      [ErrorCategory.UNAVAILABLE]: 503,
    };
    for (const [cat, status] of Object.entries(expected)) {
      expect(categoryToHttpStatus(cat as ErrorCategory)).toBe(status);
    }
  });
});

describe("CapabilityError — constructor", () => {
  it("inherits from Error and preserves message", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_SWAP_NO_LIQUIDITY",
      category: ErrorCategory.INSUFFICIENT_LIQUIDITY,
      message: "No depth",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("No depth");
    expect(err.name).toBe("CapabilityError");
  });

  it("defaults httpStatus from category", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_SWAP_UNSUPPORTED_ROUTE",
      category: ErrorCategory.UNSUPPORTED_ROUTE,
      message: "no route",
    });
    expect(err.httpStatus).toBe(404);
  });

  it("allows explicit httpStatus override", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_SWAP_RATE_LIMITED",
      category: ErrorCategory.RATE_LIMITED,
      message: "slow down",
      httpStatus: 418, // intentionally weird
    });
    expect(err.httpStatus).toBe(418);
  });

  it("preserves stack trace originating at the throw site, not the constructor", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_INTERNAL_ERROR",
      category: ErrorCategory.INTERNAL,
      message: "boom",
    });
    expect(err.stack).toBeDefined();
    // The first frame should NOT be inside the CapabilityError constructor.
    expect(err.stack?.split("\n")[1] ?? "").not.toMatch(/at new CapabilityError/);
  });

  it("preserves cause for logs but does not expose it on the wire", () => {
    const underlying = new Error("ethers: insufficient funds");
    const err = new CapabilityError({
      code: "CAPABILITY_SWAP_PROVIDER_FAILURE",
      category: ErrorCategory.PROVIDER_FAILURE,
      message: "swap failed",
      cause: underlying,
    });
    expect(err.cause).toBe(underlying);
    expect(err.toSerialized()).not.toHaveProperty("cause");
  });
});

describe("CapabilityError — toSerialized", () => {
  it("produces JSON-safe shape with required fields", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_LENDING_INSUFFICIENT_COLLATERAL",
      category: ErrorCategory.INSUFFICIENT_LIQUIDITY,
      message: "health factor too low",
      provider: "benqi",
      details: { hf: 0.95, threshold: 1.0 },
    });
    const wire = err.toSerialized();
    expect(wire).toEqual({
      code: "CAPABILITY_LENDING_INSUFFICIENT_COLLATERAL",
      category: "INSUFFICIENT_LIQUIDITY",
      message: "health factor too low",
      provider: "benqi",
      details: { hf: 0.95, threshold: 1.0 },
      httpStatus: 422,
    });
    expect(() => JSON.stringify(wire)).not.toThrow();
  });

  it("omits provider when absent", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_INTERNAL_ERROR",
      category: ErrorCategory.INTERNAL,
      message: "x",
    });
    expect(err.toSerialized()).not.toHaveProperty("provider");
  });

  it("omits details when absent", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_INTERNAL_ERROR",
      category: ErrorCategory.INTERNAL,
      message: "x",
    });
    expect(err.toSerialized()).not.toHaveProperty("details");
  });
});

describe("CapabilityError.is (structural check)", () => {
  it("returns true for an instance", () => {
    const err = new CapabilityError({
      code: "X",
      category: ErrorCategory.INTERNAL,
      message: "y",
    });
    expect(CapabilityError.is(err)).toBe(true);
  });

  it("returns true for a structurally-equivalent object (cross-module case)", () => {
    const dup = {
      name: "CapabilityError",
      code: "X",
      category: "INTERNAL",
      message: "y",
      httpStatus: 500,
    };
    expect(CapabilityError.is(dup)).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(CapabilityError.is(new Error("plain"))).toBe(false);
  });

  it("returns false for arbitrary objects and primitives", () => {
    expect(CapabilityError.is({})).toBe(false);
    expect(CapabilityError.is(null)).toBe(false);
    expect(CapabilityError.is("string")).toBe(false);
    expect(CapabilityError.is(undefined)).toBe(false);
  });
});

describe("CapabilityError factories", () => {
  it("unsupportedRoute builds a 404 with attempted providers", () => {
    const err = CapabilityError.unsupportedRoute({
      capability: "swap",
      chainId: 8453,
      attempted: ["aerodrome", "uniswap"],
      fromAsset: "USDC",
      toAsset: "ETH",
    });
    expect(err.category).toBe(ErrorCategory.UNSUPPORTED_ROUTE);
    expect(err.httpStatus).toBe(404);
    expect(err.code).toBe("CAPABILITY_SWAP_UNSUPPORTED_ROUTE");
    expect(err.message).toContain("aerodrome");
    expect(err.message).toContain("uniswap");
    expect(err.details).toMatchObject({
      capability: "swap",
      chainId: 8453,
      fromAsset: "USDC",
      toAsset: "ETH",
    });
  });

  it("allProvidersFailed is 503 with per-provider attempts", () => {
    const err = CapabilityError.allProvidersFailed({
      capability: "lending",
      attempts: [
        { provider: "benqi", error: "timeout" },
        { provider: "moonwell-stub", error: "disabled" },
      ],
    });
    expect(err.category).toBe(ErrorCategory.UNAVAILABLE);
    expect(err.httpStatus).toBe(503);
    expect(err.code).toBe("CAPABILITY_LENDING_ALL_PROVIDERS_FAILED");
    expect(err.details).toMatchObject({
      capability: "lending",
      attempts: [
        { provider: "benqi", error: "timeout" },
        { provider: "moonwell-stub", error: "disabled" },
      ],
    });
  });

  it("validation produces a 400 with the optional zod errors bag", () => {
    const err = CapabilityError.validation({
      capability: "swap",
      message: "amount must be > 0",
      errors: [{ path: ["amount"], message: "min 1" }],
    });
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("CAPABILITY_SWAP_VALIDATION_FAILED");
    expect(err.details).toEqual({
      errors: [{ path: ["amount"], message: "min 1" }],
    });
  });

  it("providerFailure preserves cause off the wire", () => {
    const root = new Error("eth_call reverted");
    const err = CapabilityError.providerFailure({
      capability: "lending",
      provider: "benqi",
      message: "supply tx reverted",
      cause: root,
    });
    expect(err.cause).toBe(root);
    expect(err.toSerialized()).not.toHaveProperty("cause");
    expect(err.provider).toBe("benqi");
  });

  it("rateLimited carries optional retryAfterMs", () => {
    const err = CapabilityError.rateLimited({
      capability: "swap",
      provider: "uniswap",
      retryAfterMs: 5000,
    });
    expect(err.httpStatus).toBe(429);
    expect(err.details).toEqual({ retryAfterMs: 5000 });
  });

  it("internal produces a 500 with cause", () => {
    const root = new TypeError("undefined is not a function");
    const err = CapabilityError.internal("orchestrator bug", root);
    expect(err.httpStatus).toBe(500);
    expect(err.code).toBe("CAPABILITY_INTERNAL_ERROR");
    expect(err.cause).toBe(root);
  });

  it("unavailable produces a 503 with optional details", () => {
    const err = CapabilityError.unavailable("Staking on Base not implemented yet", {
      stub: "BaseStakingProviderAdapter",
    });
    expect(err.httpStatus).toBe(503);
    expect(err.details).toEqual({ stub: "BaseStakingProviderAdapter" });
  });
});
