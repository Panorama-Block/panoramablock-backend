/**
 * Capability namespace routes for swap: /v1/capability/swap/*
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  createDiscoveryHandler,
  buildSuccess,
  buildError,
  CapabilityError,
  type ProviderRegistry,
  type DiscoveryHandler,
} from "@panorama/capability";
import type { ISwapProvider } from "../../../domain/ports/swap.provider.port";
import type { ProviderSelectorService } from "../../../application/services/provider-selector.service";
import { SwapRequest } from "../../../domain/entities/swap";

export interface SwapCapabilityRoutesDeps {
  registry: ProviderRegistry<ISwapProvider>;
  selector: ProviderSelectorService;
}

export function buildSwapCapabilityRouter(deps: SwapCapabilityRoutesDeps): Router {
  const router = Router();

  const discoveryHandler: DiscoveryHandler = createDiscoveryHandler({
    listProviders: () => deps.registry.listAll(),
    cacheTtlSeconds: 30,
  });

  router.get("/_discovery", (_req, res) => {
    const traceId = (_req.headers["x-trace-id"] as string) ?? randomUUID();
    res.status(200).json(discoveryHandler({ traceId }));
  });

  router.post("/quote", async (req, res) => {
    const start = Date.now();
    const traceId = (req.headers["x-trace-id"] as string) ?? randomUUID();
    try {
      const { fromChainId, toChainId, fromToken, toToken, amount, fromAddress, toAddress } = req.body;
      if (!fromChainId || !toChainId || !fromToken || !toToken || !amount) {
        throw CapabilityError.validation({
          capability: "swap",
          message: "fromChainId, toChainId, fromToken, toToken, and amount are required",
        });
      }
      const swapReq = new SwapRequest(
        fromChainId, toChainId, fromToken, toToken,
        BigInt(amount), fromAddress ?? "", toAddress ?? fromAddress ?? ""
      );
      const result = await deps.selector.getQuoteWithBestProvider(swapReq);
      res.status(200).json(
        buildSuccess({
          data: {
            provider: result.provider,
            estimatedReceiveAmount: result.quote.estimatedReceiveAmount.toString(),
            bridgeFee: result.quote.bridgeFee.toString(),
            gasFee: result.quote.gasFee.toString(),
            exchangeRate: result.quote.exchangeRate,
            estimatedDuration: result.quote.estimatedDuration,
          },
          provider: { name: result.provider },
          traceId,
          latencyMs: Date.now() - start,
        })
      );
    } catch (e) {
      const err = CapabilityError.is(e)
        ? e
        : CapabilityError.internal(`swap quote error: ${(e as Error).message}`, e);
      res.status(err.httpStatus).json(buildError({ error: err, traceId, latencyMs: Date.now() - start }));
    }
  });

  router.post("/prepare-swap", async (req, res) => {
    const start = Date.now();
    const traceId = (req.headers["x-trace-id"] as string) ?? randomUUID();
    try {
      const { fromChainId, toChainId, fromToken, toToken, amount, fromAddress, toAddress, preferredProvider } = req.body;
      if (!fromChainId || !toChainId || !fromToken || !toToken || !amount || !fromAddress) {
        throw CapabilityError.validation({
          capability: "swap",
          message: "fromChainId, toChainId, fromToken, toToken, amount, and fromAddress are required",
        });
      }
      const swapReq = new SwapRequest(
        fromChainId, toChainId, fromToken, toToken,
        BigInt(amount), fromAddress, toAddress ?? fromAddress
      );
      const result = await deps.selector.prepareSwapWithProvider(swapReq, preferredProvider);
      res.status(200).json(
        buildSuccess({
          data: {
            provider: result.provider,
            transactions: result.prepared.transactions,
            estimatedDuration: result.prepared.estimatedDuration,
            metadata: result.prepared.metadata,
          },
          provider: { name: result.provider },
          traceId,
          latencyMs: Date.now() - start,
        })
      );
    } catch (e) {
      const err = CapabilityError.is(e)
        ? e
        : CapabilityError.internal(`swap prepare error: ${(e as Error).message}`, e);
      res.status(err.httpStatus).json(buildError({ error: err, traceId, latencyMs: Date.now() - start }));
    }
  });

  return router;
}
