/**
 * Lending Capability Router — /v1/capability/lend/*
 *
 * Mounts the new capability endpoints and re-exports legacy /benqi/* routes
 * with Deprecation + Sunset headers so clients can migrate without a hard cutover.
 *
 * Endpoint map:
 *   GET  /v1/capability/lend/markets
 *   GET  /v1/capability/lend/position/:address
 *   POST /v1/capability/lend/supply/quote
 *   POST /v1/capability/lend/supply/prepare
 *   POST /v1/capability/lend/withdraw/prepare
 *   POST /v1/capability/lend/borrow/prepare
 *   POST /v1/capability/lend/repay/prepare
 *   GET  /v1/capability/lend/history/:address
 *   GET  /v1/capability/_discovery
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildSuccess, buildError, CapabilityError } from "@panorama/capability";
import type { LendingCapabilityService } from "../../../application/services/lending.capability.service";
import type { DiscoveryHandler } from "@panorama/capability";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHAIN_ID = 43114;
const DEPRECATION_DATE = "Sun, 01 Feb 2026 00:00:00 GMT";

function traceId(req: Request): string {
  return (req.headers["x-trace-id"] as string) ?? uuidv4();
}

function wrapError(err: unknown, tid: string, res: Response): void {
  const capErr = CapabilityError.is(err)
    ? (err as CapabilityError)
    : CapabilityError.internal("Unexpected error", err);
  res.status(capErr.httpStatus).json(buildError({ error: capErr, traceId: tid, latencyMs: 0 }));
}

function buildCapabilityRequest<T>(
  req: Request,
  payload: T,
  userAddress?: string,
) {
  return {
    tenantId: (req.headers["x-tenant-id"] as string) ?? "default",
    traceId: traceId(req),
    chainId: CHAIN_ID,
    userAddress: userAddress ?? (req.headers["x-user-address"] as string) ?? "",
    payload,
    receivedAt: new Date().toISOString(),
  };
}

function validateAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

function validateWei(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function addDeprecationHeaders(res: Response): void {
  res.setHeader("Deprecation", DEPRECATION_DATE);
  res.setHeader("Sunset", DEPRECATION_DATE);
  res.setHeader("Link", '</v1/capability/lend/markets>; rel="successor-version"');
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createCapabilityRouter(
  lendingService: LendingCapabilityService,
  discoveryHandler: DiscoveryHandler,
): Router {
  const router = Router();

  // ─── Discovery ─────────────────────────────────────────────────────────

  router.get("/_discovery", (req: Request, res: Response) => {
    const result = discoveryHandler({
      traceId: traceId(req),
      force: req.query["force"] === "true",
    });
    res.status(200).json(result);
  });

  // ─── GET /v1/capability/lend/markets ────────────────────────────────────

  router.get("/lend/markets", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const capReq = buildCapabilityRequest(req, {});
      const outcome = await lendingService.getMarkets(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── GET /v1/capability/lend/position/:address ──────────────────────────

  router.get("/lend/position/:address", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { address } = req.params;
      if (!validateAddress(address)) {
        throw CapabilityError.validation({
          capability: "lending",
          message: "Invalid wallet address",
        });
      }
      const capReq = buildCapabilityRequest(req, {}, address);
      const outcome = await lendingService.getUserPosition(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── POST /v1/capability/lend/supply/quote ───────────────────────────────

  router.post("/lend/supply/quote", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { qTokenAddress, amount, userAddress } = req.body ?? {};
      if (!validateAddress(qTokenAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid qTokenAddress" });
      }
      if (!validateWei(amount)) {
        throw CapabilityError.validation({ capability: "lending", message: "amount must be a decimal wei string" });
      }
      // Quote = no-fee passthrough (validation fee logic lives in execution-layer)
      res.status(200).json(
        buildSuccess({
          data: {
            qTokenAddress,
            estimatedAmount: amount,
            feeWei: "0",
            netAmount: amount,
          },
          provider: { name: "lending-service" },
          traceId: tid,
          latencyMs: Date.now() - start,
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── POST /v1/capability/lend/supply/prepare ─────────────────────────────

  router.post("/lend/supply/prepare", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { qTokenAddress, amount, userAddress } = req.body ?? {};
      if (!validateAddress(userAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid userAddress" });
      }
      if (!validateAddress(qTokenAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid qTokenAddress" });
      }
      if (!validateWei(amount)) {
        throw CapabilityError.validation({ capability: "lending", message: "amount must be a decimal wei string" });
      }
      const capReq = buildCapabilityRequest(req, { qTokenAddress, amount }, userAddress);
      const outcome = await lendingService.prepareSupply(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── POST /v1/capability/lend/withdraw/prepare ───────────────────────────

  router.post("/lend/withdraw/prepare", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { qTokenAddress, amount, byUnderlying, userAddress } = req.body ?? {};
      if (!validateAddress(userAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid userAddress" });
      }
      if (!validateAddress(qTokenAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid qTokenAddress" });
      }
      if (!validateWei(amount)) {
        throw CapabilityError.validation({ capability: "lending", message: "amount must be a decimal wei string" });
      }
      const capReq = buildCapabilityRequest(
        req,
        { qTokenAddress, amount, byUnderlying: byUnderlying !== false },
        userAddress,
      );
      const outcome = await lendingService.prepareWithdraw(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── POST /v1/capability/lend/borrow/prepare ─────────────────────────────

  router.post("/lend/borrow/prepare", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { qTokenAddress, amount, userAddress } = req.body ?? {};
      if (!validateAddress(userAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid userAddress" });
      }
      if (!validateAddress(qTokenAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid qTokenAddress" });
      }
      if (!validateWei(amount)) {
        throw CapabilityError.validation({ capability: "lending", message: "amount must be a decimal wei string" });
      }
      const capReq = buildCapabilityRequest(req, { qTokenAddress, amount }, userAddress);
      const outcome = await lendingService.prepareBorrow(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── POST /v1/capability/lend/repay/prepare ──────────────────────────────

  router.post("/lend/repay/prepare", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { qTokenAddress, amount, userAddress } = req.body ?? {};
      if (!validateAddress(userAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid userAddress" });
      }
      if (!validateAddress(qTokenAddress)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid qTokenAddress" });
      }
      if (!validateWei(amount)) {
        throw CapabilityError.validation({ capability: "lending", message: "amount must be a decimal wei string" });
      }
      const capReq = buildCapabilityRequest(req, { qTokenAddress, amount }, userAddress);
      const outcome = await lendingService.prepareRepay(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
          attemptedProviders: outcome.attempts.map((a: { provider: string; reason: string }) => ({ name: a.provider, reason: a.reason })),
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── GET /v1/capability/lend/history/:address ────────────────────────────

  router.get("/lend/history/:address", async (req: Request, res: Response) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { address } = req.params;
      if (!validateAddress(address)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid wallet address" });
      }
      const capReq = buildCapabilityRequest(req, {}, address);
      const outcome = await lendingService.getHistory(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  // ─── Legacy routes with Deprecation headers ──────────────────────────────

  /**
   * GET /v1/capability/lend/legacy/markets → proxies to the new markets endpoint
   * Kept for backward-compat; adds Deprecation + Sunset headers.
   */
  router.get("/lend/legacy/markets", async (req: Request, res: Response) => {
    addDeprecationHeaders(res);
    const tid = traceId(req);
    const start = Date.now();
    try {
      const capReq = buildCapabilityRequest(req, {});
      const outcome = await lendingService.getMarkets(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  /**
   * GET /v1/capability/lend/legacy/position/:address
   */
  router.get("/lend/legacy/position/:address", async (req: Request, res: Response) => {
    addDeprecationHeaders(res);
    const tid = traceId(req);
    const start = Date.now();
    try {
      const { address } = req.params;
      if (!validateAddress(address)) {
        throw CapabilityError.validation({ capability: "lending", message: "Invalid wallet address" });
      }
      const capReq = buildCapabilityRequest(req, {}, address);
      const outcome = await lendingService.getUserPosition(capReq);
      res.status(200).json(
        buildSuccess({
          data: outcome.data,
          provider: outcome.provider,
          traceId: tid,
          latencyMs: Date.now() - start,
        }),
      );
    } catch (err) {
      wrapError(err, tid, res);
    }
  });

  return router;
}
