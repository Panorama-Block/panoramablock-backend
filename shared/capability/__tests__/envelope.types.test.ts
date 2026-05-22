import { describe, it, expect, expectTypeOf } from "vitest";

import {
  isSuccess,
  isError,
  buildSuccess,
  buildError,
  type CapabilityRequest,
  type CapabilityResponse,
  type CapabilitySuccessResponse,
  type CapabilityErrorResponse,
  type Transaction,
} from "../envelope.types";
import { CapabilityError, ErrorCategory } from "../errors";

describe("envelope.types — CapabilityRequest", () => {
  it("accepts a typed payload", () => {
    interface SwapQuotePayload {
      fromToken: string;
      toToken: string;
      amount: string;
    }
    const req: CapabilityRequest<SwapQuotePayload> = {
      tenantId: "telegram-user-12345",
      traceId: "abc-123",
      chainId: 8453,
      userAddress: "0xabc",
      payload: { fromToken: "USDC", toToken: "ETH", amount: "100000000" },
    };
    expect(req.payload.fromToken).toBe("USDC");
    expectTypeOf(req.payload).toEqualTypeOf<SwapQuotePayload>();
  });

  it("idempotencyKey is optional", () => {
    const req: CapabilityRequest<{ x: number }> = {
      tenantId: "t",
      traceId: "u",
      chainId: 1,
      userAddress: "0x",
      payload: { x: 1 },
    };
    expect(req.idempotencyKey).toBeUndefined();
  });
});

describe("envelope.types — type guards", () => {
  const success: CapabilitySuccessResponse<number> = {
    status: "success",
    data: 42,
    provider: { name: "uniswap" },
    traceId: "abc-123",
    latencyMs: 87,
  };
  const errorResp: CapabilityErrorResponse = {
    status: "error",
    error: {
      code: "CAPABILITY_SWAP_NO_LIQUIDITY",
      category: "INSUFFICIENT_LIQUIDITY",
      message: "no",
      httpStatus: 422,
    },
    traceId: "abc-123",
    latencyMs: 12,
  };

  it("isSuccess narrows to success variant", () => {
    const r: CapabilityResponse<number> = success;
    if (isSuccess(r)) {
      expectTypeOf(r.data).toBeNumber();
      expect(r.data).toBe(42);
    } else {
      throw new Error("should have narrowed to success");
    }
  });

  it("isError narrows to error variant", () => {
    const r: CapabilityResponse<number> = errorResp;
    if (isError(r)) {
      expectTypeOf(r.error.code).toBeString();
      expect(r.error.code).toBe("CAPABILITY_SWAP_NO_LIQUIDITY");
    } else {
      throw new Error("should have narrowed to error");
    }
  });

  it("isSuccess and isError are mutually exclusive", () => {
    const responses: CapabilityResponse<number>[] = [success, errorResp];
    for (const r of responses) {
      expect(isSuccess(r) === isError(r)).toBe(false);
    }
  });
});

describe("envelope.types — buildSuccess", () => {
  it("builds a minimal success response", () => {
    const r = buildSuccess({
      data: { expectedAmount: "0.0312" },
      provider: { name: "aerodrome" },
      traceId: "abc-123",
      latencyMs: 187,
    });
    expect(r.status).toBe("success");
    expect(r.data.expectedAmount).toBe("0.0312");
    expect(r.provider.name).toBe("aerodrome");
    expect(r.attemptedProviders).toBeUndefined();
  });

  it("preserves attemptedProviders when provided", () => {
    const r = buildSuccess({
      data: 1,
      provider: { name: "uniswap" },
      traceId: "t",
      latencyMs: 50,
      attemptedProviders: [{ name: "aerodrome", reason: "unhealthy" }],
    });
    expect(r.attemptedProviders).toHaveLength(1);
    expect(r.attemptedProviders?.[0]?.name).toBe("aerodrome");
  });
});

describe("envelope.types — buildError", () => {
  it("serializes a CapabilityError into the response envelope", () => {
    const err = new CapabilityError({
      code: "CAPABILITY_SWAP_NO_LIQUIDITY",
      category: ErrorCategory.INSUFFICIENT_LIQUIDITY,
      message: "Pool depth insufficient",
      provider: "aerodrome",
    });
    const r = buildError({
      error: err,
      traceId: "abc-123",
      latencyMs: 12,
    });
    expect(r.status).toBe("error");
    expect(r.error.code).toBe("CAPABILITY_SWAP_NO_LIQUIDITY");
    expect(r.error.category).toBe("INSUFFICIENT_LIQUIDITY");
    expect(r.error.httpStatus).toBe(422);
    expect(r.error.provider).toBe("aerodrome");
  });
});

describe("envelope.types — Transaction shape", () => {
  it("accepts a minimum valid transaction", () => {
    const tx: Transaction = {
      chainId: 8453,
      to: "0x1234",
      data: "0xabcd",
      value: "0",
    };
    expect(tx.value).toBe("0");
  });

  it("accepts EIP-1559 fee fields", () => {
    const tx: Transaction = {
      chainId: 1,
      to: "0xabc",
      data: "0x",
      value: "1000000",
      maxFeePerGas: "30000000000",
      maxPriorityFeePerGas: "1000000000",
      feeMode: "authoritative",
    };
    expect(tx.feeMode).toBe("authoritative");
  });
});
