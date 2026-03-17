import type {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express-serve-static-core";

import { GetQuoteUseCase } from "../../../application/usecases/get.quote.usecase";
import {
  ExecuteSwapUseCase,
  GetSwapHistoryUseCase,
} from "../../../application/usecases/execute.swap.usecase";
import { PrepareSwapUseCase } from "../../../application/usecases/prepare.swap.usecase";
import { GetSwapStatusUseCase } from "../../../application/usecases/get.status.usecase";
import {
  SwapError,
  SwapErrorCode,
  createForbiddenError,
  createMissingParamsError,
  createServiceUnavailableError,
  createUnauthorizedError,
} from "../../../domain/entities/errors";

// Alias dos tipos base
type Request = ExpressRequest;
type Response = ExpressResponse;

// Tipagem local para acessar req.user (endereço do usuário autenticado)
type RequestWithUser = Request & {
  user?: { address: string; [k: string]: any };
};

const EXECUTION_LAYER_URL = process.env.EXECUTION_LAYER_URL || 'http://localhost:3011';
const AVAX_CHAIN_ID = 43114;

// Known AVAX token decimals for amount conversion
const AVAX_TOKEN_DECIMALS: Record<string, number> = {
  '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7': 18, // WAVAX
  'native': 18,                                       // AVAX native
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 6,  // USDC
  '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 6,  // USDT
  '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664': 6,  // USDC.e
  '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab': 18, // WETH.e
  '0x152b9d0fdc40c096757f570a51e494bd4b943e50': 8,  // BTC.b
};

function toAvaxWei(amount: string, tokenAddress: string): string {
  const decimals = AVAX_TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  if (amount.includes('.')) {
    const [int, frac = ''] = amount.split('.');
    const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
    return (BigInt(int) * BigInt(10 ** decimals) + BigInt(fracPadded || '0')).toString();
  }
  // Already looks like wei if it's a large integer
  if (/^\d+$/.test(amount) && amount.length > 12) return amount;
  return (BigInt(amount) * BigInt(10 ** decimals)).toString();
}

export class SwapController {
  constructor(
    private readonly getQuoteUseCase: GetQuoteUseCase,
    private readonly prepareSwapUseCase: PrepareSwapUseCase,
    private readonly executeSwapUseCase: ExecuteSwapUseCase,
    private readonly getSwapHistoryUseCase: GetSwapHistoryUseCase,
    private readonly getSwapStatusUseCase: GetSwapStatusUseCase
  ) {}

  // ─── AVAX Swap Proxy ────────────────────────────────────────────────────────

  private proxyAvaxQuote = async (
    fromToken: string, toToken: string, amountWei: string,
    fromChainId: number, toChainId: number, res: Response, next: NextFunction
  ): Promise<Response | void> => {
    try {
      const execRes = await fetch(`${EXECUTION_LAYER_URL}/avax/swap/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: fromToken, tokenOut: toToken, amountIn: amountWei, slippageBps: 50 }),
      });
      const execData = await execRes.json() as any;
      if (execData.error) {
        console.error('[SwapController] AVAX quote error from execution layer:', execData.error);
        return next(new SwapError(SwapErrorCode.PROVIDER_ERROR, execData.error?.message || 'AVAX quote failed'));
      }
      const amountOut: string = execData.amountOut ?? '0';
      const amountIn: string = execData.amountIn ?? amountWei;
      const rate = amountIn !== '0' ? (Number(amountOut) / Number(amountIn)).toFixed(8) : '0';
      return res.json({
        success: true,
        quote: {
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount: amountIn,
          estimatedReceiveAmount: amountOut,
          exchangeRate: rate,
          fees: { gasFee: '0', bridgeFee: '0', totalFee: '0', totalFeeUsd: '0' },
          provider: 'trader-joe',
        },
      });
    } catch (err) {
      console.error('[SwapController] AVAX quote proxy failed:', err);
      return next(new SwapError(SwapErrorCode.PROVIDER_ERROR, 'AVAX quote proxy failed'));
    }
  };

  private proxyAvaxPrepare = async (
    fromToken: string, toToken: string, amountWei: string,
    sender: string, fromChainId: number, res: Response, next: NextFunction
  ): Promise<Response | void> => {
    try {
      const execRes = await fetch(`${EXECUTION_LAYER_URL}/avax/swap/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: sender, tokenIn: fromToken, tokenOut: toToken, amountIn: amountWei, slippageBps: 50, deadlineMinutes: 20 }),
      });
      const execData = await execRes.json() as any;
      if (execData.error) {
        console.error('[SwapController] AVAX prepare error from execution layer:', execData.error);
        return next(new SwapError(SwapErrorCode.PROVIDER_ERROR, execData.error?.message || 'AVAX prepare failed'));
      }
      // Map bundle.steps → prepared.transactions (format expected by miniapp)
      const steps: any[] = execData.bundle?.steps ?? [];
      const transactions = steps.map((s: any) => ({
        to: s.to,
        data: s.data,
        value: s.value ?? '0',
        chainId: s.chainId ?? AVAX_CHAIN_ID,
      }));
      return res.json({
        success: true,
        prepared: { transactions },
        provider: 'trader-joe',
      });
    } catch (err) {
      console.error('[SwapController] AVAX prepare proxy failed:', err);
      return next(new SwapError(SwapErrorCode.PROVIDER_ERROR, 'AVAX prepare proxy failed'));
    }
  };

  // ─── Quote ──────────────────────────────────────────────────────────────────

  public getQuote = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      console.log("[SwapController] Getting swap quote");

      const { fromChainId, toChainId, fromToken, toToken, amount, unit, smartAccountAddress } =
        (req.body ?? {}) as {
          fromChainId?: number;
          toChainId?: number;
          fromToken?: string;
          toToken?: string;
          amount?: string;
          unit?: "token" | "wei";
          smartAccountAddress?: string;
        };

      if (!fromChainId || !toChainId || !fromToken || !toToken || !amount || !smartAccountAddress) {
        return next(
          createMissingParamsError([
            "fromChainId",
            "toChainId",
            "fromToken",
            "toToken",
            "amount",
            "smartAccountAddress",
          ])
        );
      }

      const resolveUnit = (rawAmount: string, rawUnit?: "token" | "wei"): "token" | "wei" => {
        if (rawUnit) return rawUnit;
        // Back-compat guardrail: if the caller forgets unit, infer it.
        // - decimals => token units
        // - long integer => probably wei (common bug: passing wei while omitting unit)
        const trimmed = String(rawAmount).trim();
        if (trimmed.includes(".")) return "token";
        if (/^\d+$/.test(trimmed) && trimmed.length > 12) return "wei";
        return "token";
      };

      const resolvedUnit = resolveUnit(amount, unit);
      if (!unit) {
        console.warn(
          `[SwapController] ⚠️ Missing unit in /swap/quote request; inferred '${resolvedUnit}'. Callers should always send unit explicitly.`
        );
      }

      // ── AVAX routing ──────────────────────────────────────────────────────
      if (fromChainId === AVAX_CHAIN_ID) {
        console.log('[SwapController] AVAX chain detected — routing quote to execution layer');
        const amountWei = resolvedUnit === 'wei' ? amount : toAvaxWei(amount, fromToken!);
        return this.proxyAvaxQuote(fromToken!, toToken!, amountWei, fromChainId, toChainId!, res, next);
      }
      // ─────────────────────────────────────────────────────────────────────

      const sender = smartAccountAddress
      console.log(`[SwapController] Getting quote for user: ${sender}`);
      if (!sender) {
        return next(createMissingParamsError(["smartAccountAddress"]));
      }
      const quote = await this.getQuoteUseCase.execute({
        fromChainId,
        toChainId,
        fromToken,
        toToken,
        amount,
        unit: resolvedUnit,
        sender,
      });

      console.log(`[SwapController] Quote obtained from provider: ${quote.provider}`);

      // The quote already includes the provider field
      return res.json({ success: true, quote });
    } catch (error) {
      console.error("[SwapController] Error getting quote:", error);
      return next(error);
    }
  };

  /**
   * Retorna o bundle "prepared" (approve? + swap) para o cliente assinar.
   */
  public getPreparedTx = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      console.log("[SwapController] Preparing swap (bundle)");

      const { fromChainId, toChainId, fromToken, toToken, amount, unit, sender, provider: preferredProvider } =
        (req.body ?? {}) as {
          fromChainId?: number;
          toChainId?: number;
          fromToken?: string;
          toToken?: string;
          amount?: string;
          unit?: "token" | "wei";
          sender?: string;
          provider?: string;
        };

      if (!fromChainId || !toChainId || !fromToken || !toToken || !amount || !sender) {
        return next(
          createMissingParamsError([
            "fromChainId",
            "toChainId",
            "fromToken",
            "toToken",
            "amount",
            "sender",
          ])
        );
      }

      const receiver = sender;

      const resolveUnit = (amountStr: string, u?: "token" | "wei"): "token" | "wei" => {
        if (u === "token" || u === "wei") return u;
        const trimmed = String(amountStr || "").trim();
        if (/^\d+$/.test(trimmed) && trimmed.length > 12) return "wei";
        return "token";
      };

      const resolvedUnit = resolveUnit(amount, unit);
      if (!unit) {
        console.warn(
          `[SwapController] ⚠️ Missing unit in /swap/tx request; inferred '${resolvedUnit}'. Callers should always send unit explicitly.`
        );
      }

      // ── AVAX routing ──────────────────────────────────────────────────────
      if (fromChainId === AVAX_CHAIN_ID) {
        console.log('[SwapController] AVAX chain detected — routing prepare to execution layer');
        const amountWei = resolvedUnit === 'wei' ? amount : toAvaxWei(amount, fromToken!);
        return this.proxyAvaxPrepare(fromToken!, toToken!, amountWei, sender!, fromChainId, res, next);
      }
      // ─────────────────────────────────────────────────────────────────────

      console.log(`[SwapController] Preparing with${preferredProvider ? ` preferred provider: ${preferredProvider}` : ' auto-select'}`);

      const { prepared, provider } = await this.prepareSwapUseCase.execute({
        fromChainId,
        toChainId,
        fromToken,
        toToken,
        amount,
        unit: resolvedUnit,
        sender,
        receiver,
        provider: preferredProvider, // Pass preferred provider from quote
      });

      const serializedPrepared = this.serializeBigInt(prepared);

      console.log(`[SwapController] Swap prepared using provider: ${provider}`);
      return res.json({ success: true, prepared: serializedPrepared, provider });
    } catch (error) {
      console.error("[SwapController] Error preparing swap:", error);
      return next(error);
    }
  };

  private serializeBigInt = (obj: any) => {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  };

  /**
   * Mantido por compatibilidade; retorna 501 no V1 non-custodial.
   */
  public executeSwap = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      if (process.env.ENGINE_ENABLED !== "true") {
        return next(
          createServiceUnavailableError(
            "Server-side execution disabled (ENGINE_ENABLED !== true)"
          )
        );
      }

      const {
        fromChainId,
        toChainId,
        fromToken,
        toToken,
        amount,
        smartAccountAddress,
        receiver,
      } = (req.body ?? {}) as {
        fromChainId?: number;
        toChainId?: number;
        fromToken?: string;
        toToken?: string;
        amount?: string;
        smartAccountAddress?: string;
        receiver?: string;
      };

      if (
        !fromChainId ||
        !toChainId ||
        !fromToken ||
        !toToken ||
        !amount ||
        !smartAccountAddress
      ) {
        return next(
          createMissingParamsError([
            "fromChainId",
            "toChainId",
            "fromToken",
            "toToken",
            "amount",
            "smartAccountAddress",
          ])
        );
      }

      const sender = smartAccountAddress;
      if (!sender) {
        return next(createMissingParamsError(["smartAccountAddress"]));
      }
      
      const signerAddress = process.env.ADMIN_WALLET_ADDRESS;
      if (!signerAddress) {
        return next(
          createServiceUnavailableError(
            "Missing backend wallet address configuration"
          )
        );
      }

      if (process.env.DEBUG === "true") {
        console.log("[SwapController] Execute payload:", {
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount,
          sender,
          receiver: receiver || sender,
        });
      }

      const resp = await this.executeSwapUseCase.execute({
        fromChainId,
        toChainId,
        fromToken,
        toToken,
        amount,
        sender,
        receiver,
        signerAddress,
      });

      return res.json(resp);
    } catch (error) {
      console.error("[SwapController] Error executing swap:", error);
      return next(error);
    }
  };

  public getSwapHistory = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      console.log("[SwapController] Getting swap history");

      const aReq = req as RequestWithUser;
      const { userAddress } = (req.params ?? {}) as { userAddress?: string };

      let targetAddress = userAddress;
      if (!targetAddress) {
        if (!aReq.user?.address) {
          return next(
            createUnauthorizedError(
              "User address not found in authentication token"
            )
          );
        }
        targetAddress = aReq.user.address;
      }

      if (aReq.user?.address && targetAddress !== aReq.user.address) {
        return next(
          createForbiddenError("You can only access your own swap history")
        );
      }

      const history = await this.getSwapHistoryUseCase.execute(targetAddress!);

      return res.json({
        success: true,
        data: {
          userAddress: targetAddress,
          swaps: history.map((swap) => ({
            transactions: swap.transactions.map((tx) => ({
              hash: tx.hash,
              chainId: tx.chainId,
              status: tx.status,
            })),
            startTime: swap.startTime,
            endTime: swap.endTime,
            duration: swap.getDuration(),
          })),
        },
      });
    } catch (error) {
      console.error("[SwapController] Error getting swap history:", error);
      return next(error);
    }
  };

  public getStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      console.log("[SwapController] Getting swap status");

      const { transactionHash } = (req.params ?? {}) as {
        transactionHash?: string;
      };
      if (!transactionHash) {
        return next(createMissingParamsError(["transactionHash"]));
      }

      const aReq = req as RequestWithUser;
      if (!aReq.user?.address) {
        return next(
          createUnauthorizedError(
            "User address not found in authentication token"
          )
        );
      }

      const chainIdRaw = (req.query?.chainId as string) || "";
      const chainId = Number(chainIdRaw);
      if (!chainId || Number.isNaN(chainId)) {
        return next(
          new SwapError(
            SwapErrorCode.INVALID_REQUEST,
            "Missing or invalid chainId",
            { provided: chainIdRaw }
          )
        );
      }

      const out = await this.getSwapStatusUseCase.execute({
        transactionHash,
        chainId,
      });

      return res.json({ success: true, data: { ...out, userAddress: aReq.user.address } });
    } catch (error) {
      console.error("[SwapController] Error getting swap status:", error);
      return next(error);
    }
  };

  /**
   * DEBUG ENDPOINT: Compare transaction payloads from Thirdweb vs Uniswap
   *
   * This endpoint prepares the same swap with both providers and returns
   * the detailed transaction data for comparison.
   */
  public compareProviders = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response | void> => {
    try {
      console.log("[SwapController] 🔍 Comparing provider payloads");

      const { fromChainId, toChainId, fromToken, toToken, amount, sender } =
        (req.body ?? {}) as {
          fromChainId?: number;
          toChainId?: number;
          fromToken?: string;
          toToken?: string;
          amount?: string;
          sender?: string;
        };

      if (!fromChainId || !toChainId || !fromToken || !toToken || !amount || !sender) {
        return next(
          createMissingParamsError([
            "fromChainId",
            "toChainId",
            "fromToken",
            "toToken",
            "amount",
            "sender",
          ])
        );
      }

      const receiver = sender;

      const results: any = {
        request: {
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount,
          sender,
        },
        providers: {},
      };

      // Try Thirdweb
      try {
        console.log("[SwapController] 🔍 Preparing with Thirdweb...");
        const thirdwebResult = await this.prepareSwapUseCase.execute({
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount,
          sender,
          receiver,
          provider: "thirdweb",
        });

        results.providers.thirdweb = {
          success: true,
          provider: thirdwebResult.provider,
          prepared: this.serializeBigInt(thirdwebResult.prepared),
        };
      } catch (error) {
        results.providers.thirdweb = {
          success: false,
          error: (error as Error).message,
        };
      }

      // Try Uniswap Smart Router
      try {
        console.log("[SwapController] 🔍 Preparing with Uniswap Smart Router...");
        const uniswapResult = await this.prepareSwapUseCase.execute({
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount,
          sender,
          receiver,
          provider: "uniswap-smart-router",
        });

        results.providers["uniswap-smart-router"] = {
          success: true,
          provider: uniswapResult.provider,
          prepared: this.serializeBigInt(uniswapResult.prepared),
        };
      } catch (error) {
        results.providers["uniswap-smart-router"] = {
          success: false,
          error: (error as Error).message,
        };
      }

      // Try Uniswap Trading API
      try {
        console.log("[SwapController] 🔍 Preparing with Uniswap Trading API...");
        const tradingApiResult = await this.prepareSwapUseCase.execute({
          fromChainId,
          toChainId,
          fromToken,
          toToken,
          amount,
          sender,
          receiver,
          provider: "uniswap-trading-api",
        });

        results.providers["uniswap-trading-api"] = {
          success: true,
          provider: tradingApiResult.provider,
          prepared: this.serializeBigInt(tradingApiResult.prepared),
        };
      } catch (error) {
        results.providers["uniswap-trading-api"] = {
          success: false,
          error: (error as Error).message,
        };
      }

      console.log("[SwapController] ✅ Provider comparison complete");
      return res.json({ success: true, comparison: results });
    } catch (error) {
      console.error("[SwapController] Error comparing providers:", error);
      return next(error);
    }
  };
}
