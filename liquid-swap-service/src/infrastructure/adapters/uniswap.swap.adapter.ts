// Uniswap Swap Adapter
// Implements ISwapProvider using Uniswap Trading API
import axios, { AxiosInstance } from 'axios';
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from "../../domain/ports/swap.provider.port";
import { SwapRequest, SwapQuote, TransactionStatus } from "../../domain/entities/swap";
import { resolveToken, listSupportedChainsForProvider } from "../../config/tokens/registry";
import { ChainProviderAdapter } from "./chain.provider.adapter";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SLIPPAGE_TOLERANCE = 0.5; // 0.5%
const API_REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000; // 1 second

const UNISWAP_SUPPORTED_CHAINS = new Set<number>(
  listSupportedChainsForProvider('uniswap')
);

enum UniswapRouting {
  CLASSIC = 'CLASSIC',
  DUTCH_V2 = 'DUTCH_V2',
  DUTCH_V3 = 'DUTCH_V3',
  BRIDGE = 'BRIDGE',
  PRIORITY = 'PRIORITY',
  WRAP = 'WRAP',
  UNWRAP = 'UNWRAP',
  LIMIT_ORDER = 'LIMIT_ORDER',
  DUTCH_LIMIT = 'DUTCH_LIMIT',
}

// ============================================================================
// TYPES
// ============================================================================

interface QuoteParams {
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  amount: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  tokenIn: string;
  tokenOut: string;
  swapper: string;
  slippageTolerance?: number;
}

interface QuoteResponse {
  requestId: string;
  routing: UniswapRouting;
  quote: {
    chainId: number;
    input: { amount: string; token: string };
    output: { amount: string; token: string; recipient: string };
    swapper: string;
    slippage: number;
    tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
    quoteId: string;
    priceImpact?: number;
    gasFee?: string;
    gasUseEstimate?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    route?: any[];
  };
  permitData?: any;
}

interface CheckApprovalParams {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
}

interface CheckApprovalResponse {
  requestId: string;
  approval: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  } | null;
  permit2?: any;
}

interface SwapParams {
  quote: QuoteResponse['quote'];
  permitSignature?: string;
}

interface SwapResponse {
  requestId: string;
  swap: {
    to: string;
    data: string;
    value: string;
    chainId: number | string;
    from?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  gasFee?: string;
}

interface OrderParams {
  quote: QuoteResponse['quote'];
  permitSignature?: string;
}

interface OrderResponse {
  requestId: string;
  orderId: string;
  orderHash: string;
  signature: string;
  encodedOrder: string;
  orderInfo: {
    reactor: string;
    swapper: string;
    nonce: string;
    deadline: number;
    startAmount: string;
    endAmount: string;
  };
}

// ============================================================================
// UNISWAP SWAP ADAPTER
// ============================================================================

export class UniswapSwapAdapter implements ISwapProvider {
  public readonly name = "uniswap";

  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly axios: AxiosInstance;
  private readonly chainProvider: ChainProviderAdapter;
  private readonly enabled: boolean;

  constructor() {
    this.apiKey = process.env.UNISWAP_API_KEY || "";
    this.enabled = process.env.UNISWAP_ENABLED === "true" && !!this.apiKey;

    if (!this.enabled) {
      console.warn("[UniswapSwapAdapter] ⚠️ Provider disabled (UNISWAP_ENABLED !== true or no API key)");
    }

    this.baseURL = process.env.UNISWAP_API_URL || 'https://trade-api.gateway.uniswap.org/v1';

    this.axios = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      timeout: API_REQUEST_TIMEOUT,
    });

    this.axios.interceptors.response.use(
      (response) => {
        console.log(`[UniswapAPI] ✅ ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error)) {
          console.error(`[UniswapAPI] ❌ ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.response?.status || 'FAILED'}`);
        }
        return Promise.reject(error);
      }
    );

    this.chainProvider = new ChainProviderAdapter();

    console.log(`[UniswapSwapAdapter] Initialized (enabled: ${this.enabled}, baseURL: ${this.baseURL})`);
  }

  /**
   * Check if Uniswap supports this route
   * Uniswap Trading API only supports SAME-CHAIN swaps
   */
  async supportsRoute(params: RouteParams): Promise<boolean> {
    if (!this.enabled) {
      console.log("[UniswapSwapAdapter] Provider disabled");
      return false;
    }

    if (params.fromChainId !== params.toChainId) {
      console.log("[UniswapSwapAdapter] Cross-chain not supported");
      return false;
    }

    if (!UNISWAP_SUPPORTED_CHAINS.has(params.fromChainId)) {
      console.log(`[UniswapSwapAdapter] Chain ${params.fromChainId} not supported`);
      return false;
    }

    try {
      resolveToken('uniswap', params.fromChainId, params.fromToken);
      resolveToken('uniswap', params.toChainId, params.toToken);
    } catch (error) {
      console.log(
        `[UniswapSwapAdapter] Tokens not supported for chain ${params.fromChainId}:`,
        (error as Error).message
      );
      return false;
    }

    console.log(`[UniswapSwapAdapter] ✅ Route supported (chain ${params.fromChainId})`);
    return true;
  }

  /**
   * Get swap quote from Uniswap
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    console.log("[UniswapSwapAdapter] Getting quote:", request.toLogString());

    try {
      const inputToken = resolveToken('uniswap', request.fromChainId, request.fromToken);
      const outputToken = resolveToken('uniswap', request.toChainId, request.toToken);

      const tokenIn = inputToken.identifier;
      const tokenOut = outputToken.identifier;

      const quoteResponse = await this.requestWithRetry<QuoteResponse>({
        method: 'POST',
        url: '/quote',
        data: {
          type: "EXACT_INPUT",
          amount: request.amount.toString(),
          tokenInChainId: request.fromChainId,
          tokenOutChainId: request.toChainId,
          tokenIn,
          tokenOut,
          swapper: request.sender,
          slippageTolerance: DEFAULT_SLIPPAGE_TOLERANCE,
        } as QuoteParams,
      });

      console.log("[UniswapSwapAdapter] Quote received:", {
        routing: quoteResponse.routing,
        outputAmount: quoteResponse.quote.output.amount,
        priceImpact: quoteResponse.quote.priceImpact,
      });

      const estimatedReceiveAmount = BigInt(quoteResponse.quote.output.amount);
      const bridgeFee = BigInt(0); // N/A for same-chain
      const gasFee = await this.parseGasFee(quoteResponse, request.fromChainId);
      const exchangeRate = this.calculateExchangeRate(
        request.amount,
        inputToken.metadata.decimals,
        estimatedReceiveAmount,
        outputToken.metadata.decimals
      );
      const estimatedDuration = this.getEstimatedDuration(quoteResponse.routing);

      const quote = new SwapQuote(
        estimatedReceiveAmount,
        bridgeFee,
        gasFee,
        exchangeRate,
        estimatedDuration
      );

      console.log("[UniswapSwapAdapter] ✅ Quote parsed:", {
        receiveAmount: estimatedReceiveAmount.toString(),
        gasFee: gasFee.toString(),
        exchangeRate,
        duration: estimatedDuration,
      });

      return quote;
    } catch (error) {
      console.error("[UniswapSwapAdapter] ❌ Quote failed:", (error as Error).message);
      throw new Error(`Uniswap quote failed: ${(error as Error).message}`);
    }
  }

  /**
   * Prepare swap transactions
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    console.log("[UniswapSwapAdapter] Preparing swap:", request.toLogString());

    try {
      // Step 1: Resolve tokens and get fresh quote
      const inputToken = resolveToken('uniswap', request.fromChainId, request.fromToken);
      const outputToken = resolveToken('uniswap', request.toChainId, request.toToken);

      const tokenIn = inputToken.identifier;
      const tokenOut = outputToken.identifier;

      const quoteResponse = await this.requestWithRetry<QuoteResponse>({
        method: 'POST',
        url: '/quote',
        data: {
          type: "EXACT_INPUT",
          amount: request.amount.toString(),
          tokenInChainId: request.fromChainId,
          tokenOutChainId: request.toChainId,
          tokenIn,
          tokenOut,
          swapper: request.sender,
          slippageTolerance: DEFAULT_SLIPPAGE_TOLERANCE,
        } as QuoteParams,
      });

      const routing = quoteResponse.routing;
      console.log("[UniswapSwapAdapter] Quote routing:", routing);

      // Step 2: Build pending transactions list (approval + swap)
      const transactions: Transaction[] = [];

      if (!inputToken.isNative) {
        console.log("[UniswapSwapAdapter] 🔍 Checking approval for ERC-20 token...");
        console.log("[UniswapSwapAdapter] Wallet:", request.sender);
        console.log("[UniswapSwapAdapter] Token:", tokenIn);
        console.log("[UniswapSwapAdapter] Amount:", request.amount.toString());

        const approvalCheck = await this.requestWithRetry<CheckApprovalResponse>({
          method: 'POST',
          url: '/check_approval',
          data: {
            walletAddress: request.sender,
            token: tokenIn,
            amount: request.amount.toString(),
            chainId: request.fromChainId,
          } as CheckApprovalParams,
        });

        console.log("[UniswapSwapAdapter] ✅ Approval check response:", JSON.stringify(approvalCheck, null, 2));

        if (approvalCheck.permit2) {
          throw new Error(
            `PERMIT2_SIGNATURE_REQUIRED: ${JSON.stringify(approvalCheck.permit2)}`
          );
        }

        if (approvalCheck.approval) {
          console.log("[UniswapSwapAdapter] ⚠️ Approval required - adding approval transaction");

          transactions.push({
            chainId: request.fromChainId,
            to: approvalCheck.approval.to,
            data: approvalCheck.approval.data,
            value: this.normalizeHexValue(approvalCheck.approval.value),
            feeMode: "advisory",
            action: "approval",
          });
        } else {
          console.log("[UniswapSwapAdapter] ✅ No approval needed (already approved or permit2)");
        }
      }

      // Step 3: Build swap/order transaction based on routing
      let expiresAt: Date | undefined;
      let swapResponsePayload: SwapResponse | null = null;
      let orderResponsePayload: OrderResponse | null = null;

      if (routing === UniswapRouting.CLASSIC) {
        console.log("[UniswapSwapAdapter] Creating CLASSIC swap transaction");

        const swapResponse = await this.requestWithRetry<SwapResponse>({
          method: 'POST',
          url: '/swap',
          data: { quote: quoteResponse.quote } as SwapParams,
        });
        swapResponsePayload = swapResponse;

        const txRequest = swapResponse.swap;
        if (!txRequest) {
          console.error("[UniswapSwapAdapter] Swap response missing transaction payload", swapResponse);
          throw new Error("Uniswap swap response missing transaction payload");
        }

        const chainId =
          typeof txRequest.chainId === "string"
            ? Number(txRequest.chainId)
            : txRequest.chainId;
        if (!chainId || Number.isNaN(chainId)) {
          throw new Error("Uniswap swap response returned invalid chainId");
        }

       transactions.push({
          chainId,
          to: txRequest.to,
          data: txRequest.data,
          value: this.normalizeHexValue(txRequest.value),
          gasLimit: txRequest.gasLimit,
          maxFeePerGas: txRequest.maxFeePerGas || txRequest.gasPrice,
          maxPriorityFeePerGas: txRequest.maxPriorityFeePerGas,
          feeMode: "advisory",
        });

        expiresAt = new Date(Date.now() + 60000); // 1 minute
      } else {
        console.log("[UniswapSwapAdapter] Creating UniswapX order");

        const orderResponse = await this.requestWithRetry<OrderResponse>({
          method: 'POST',
          url: '/order',
          data: { quote: quoteResponse.quote } as OrderParams,
        });
        orderResponsePayload = orderResponse;

        console.log("[UniswapSwapAdapter] UniswapX order created:", orderResponse.orderId);

        transactions.push({
          chainId: request.fromChainId,
          to: "0x0000000000000000000000000000000000000000",
          data: orderResponse.encodedOrder,
          value: "0",
          feeMode: "advisory",
        });

        expiresAt = new Date(orderResponse.orderInfo.deadline * 1000);
      }

      const prepared: PreparedSwap = {
        provider: this.name,
        transactions,
        estimatedDuration: this.getEstimatedDuration(routing),
        expiresAt,
        metadata: {
          routing,
          quote: quoteResponse,
          swapResponse: swapResponsePayload || undefined,
          orderResponse: orderResponsePayload || undefined,
        },
      };

      console.log("[UniswapSwapAdapter] ✅ Swap prepared:", {
        routing,
        transactionsCount: transactions.length,
        expiresAt,
      });

      return prepared;
    } catch (error) {
      console.error("[UniswapSwapAdapter] ❌ Prepare failed:", (error as Error).message);
      throw error;
    }
  }

  /**
   * Monitor transaction status
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> {
    console.log("[UniswapSwapAdapter] Monitoring transaction:", txHash);

    try {
      if (txHash.startsWith("0x") && txHash.length === 66) {
        console.log("[UniswapSwapAdapter] Monitoring on-chain transaction");

        const provider = this.chainProvider.getProvider(chainId);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
          return TransactionStatus.PENDING;
        }

        if (receipt.status === 1) {
          return TransactionStatus.COMPLETED;
        } else {
          return TransactionStatus.FAILED;
        }
      } else {
        console.log("[UniswapSwapAdapter] Monitoring UniswapX order");

        const statusResponse = await this.requestWithRetry<any>({
          method: 'GET',
          url: `/orders?orderId=${txHash}`,
        });

        if (statusResponse.orders.length === 0) {
          return TransactionStatus.PENDING;
        }

        const order = statusResponse.orders[0];

        switch (order.status) {
          case "filled":
            return TransactionStatus.COMPLETED;
          case "error":
          case "cancelled":
          case "insufficient-funds":
          case "expired":
            return TransactionStatus.FAILED;
          default:
            return TransactionStatus.PENDING;
        }
      }
    } catch (error) {
      console.error("[UniswapSwapAdapter] Monitor error:", (error as Error).message);
      return TransactionStatus.PENDING;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private normalizeHexValue(value?: string | number | bigint): string {
    if (value === undefined || value === null) {
      return "0";
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "number") {
      return BigInt(Math.trunc(value)).toString();
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return "0";
      }
      return trimmed.startsWith("0x") ? BigInt(trimmed).toString() : trimmed;
    }
    return "0";
  }

  private async parseGasFee(quoteResponse: QuoteResponse, chainId: number): Promise<bigint> {
    if (quoteResponse.quote.gasFee) {
      console.log("[UniswapSwapAdapter] Using gasFee from API:", quoteResponse.quote.gasFee);
      return BigInt(quoteResponse.quote.gasFee);
    }

    if (quoteResponse.quote.gasUseEstimate) {
      console.log("[UniswapSwapAdapter] Calculating gas from estimate:", quoteResponse.quote.gasUseEstimate);

      const gasLimit = BigInt(quoteResponse.quote.gasUseEstimate);

      try {
        const provider = this.chainProvider.getProvider(chainId);
        const feeData = await provider.getFeeData();

        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
        if (gasPrice) {
          const gasFee = gasLimit * BigInt(gasPrice.toString());
          console.log("[UniswapSwapAdapter] Calculated gas fee:", gasFee.toString());
          return gasFee;
        }
      } catch (error) {
        console.warn("[UniswapSwapAdapter] Failed to get gas price from chain:", (error as Error).message);
      }

      const fallbackGasPrice = BigInt(30_000_000_000); // 30 gwei
      return gasLimit * fallbackGasPrice;
    }

    console.warn("[UniswapSwapAdapter] No gas data, using fallback estimate");
    const fallbackGasLimit = BigInt(300000);
    const fallbackGasPrice = BigInt(30_000_000_000);
    return fallbackGasLimit * fallbackGasPrice;
  }

  private calculateExchangeRate(
    amountIn: bigint,
    decimalsIn: number,
    amountOut: bigint,
    decimalsOut: number
  ): number {
    const inNumber = Number(amountIn) / Math.pow(10, decimalsIn);
    const outNumber = Number(amountOut) / Math.pow(10, decimalsOut);

    if (inNumber === 0) {
      return 0;
    }

    const rate = outNumber / inNumber;
    console.log("[UniswapSwapAdapter] Exchange rate:", rate);
    return rate;
  }

  private getEstimatedDuration(routing: UniswapRouting): number {
    switch (routing) {
      case UniswapRouting.CLASSIC:
        return 30; // 30 seconds
      case UniswapRouting.DUTCH_V2:
      case UniswapRouting.DUTCH_V3:
      case UniswapRouting.PRIORITY:
        return 120; // 2 minutes
      case UniswapRouting.BRIDGE:
        return 600; // 10 minutes
      default:
        return 60; // 1 minute
    }
  }

  private async requestWithRetry<T>(config: any, attempt = 1): Promise<T> {
    try {
      const response = await this.axios.request<T>(config);
      return response.data;
    } catch (error: any) {
      const isRetriable = this.isRetriableError(error);
      const canRetry = attempt < MAX_RETRY_ATTEMPTS;

      if (isRetriable && canRetry) {
        const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt - 1), 10000);

        console.warn(`[UniswapAPI] ⚠️ Retry attempt ${attempt}/${MAX_RETRY_ATTEMPTS} after ${delay}ms`);

        await this.sleep(delay);
        return this.requestWithRetry<T>(config, attempt + 1);
      }

      throw this.handleError(error);
    }
  }

  private isRetriableError(error: any): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;

    if (!status) return true;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;

    return false;
  }

  private handleError(error: unknown): Error {
    if (!axios.isAxiosError(error)) {
      return error as Error;
    }

    const status = error.response?.status;
    const data = error.response?.data as any;

    let message = 'Uniswap API error';

    if (status === 401) {
      message = 'Uniswap API: Invalid or missing API key';
    } else if (status === 404) {
      message = 'Uniswap API: No route found for this swap';
    } else if (status === 419) {
      message = 'Uniswap API: Rate limit exceeded. Please try again later';
    } else if (status === 400) {
      message = `Uniswap API: Invalid request - ${data?.message || error.message}`;
    } else if (status && status >= 500) {
      message = `Uniswap API: Server error (${status}). Please try again`;
    } else if (data?.message) {
      message = `Uniswap API: ${data.message}`;
    } else if (error.message) {
      message = `Uniswap API: ${error.message}`;
    }

    console.error('[UniswapAPI] Error details:', {
      status,
      message: data?.message,
      errorCode: data?.errorCode,
      detail: data?.detail,
    });

    return new Error(message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      await this.requestWithRetry<QuoteResponse>({
        method: 'POST',
        url: '/quote',
        data: {
          type: 'EXACT_INPUT',
          amount: '1000000',
          tokenInChainId: 1,
          tokenOutChainId: 1,
          tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          swapper: '0x0000000000000000000000000000000000000000',
          slippageTolerance: 0.5,
        } as QuoteParams,
      });

      console.log('[UniswapAPI] ✅ Connection test successful');
      return true;
    } catch (error) {
      console.error('[UniswapAPI] ❌ Connection test failed:', (error as Error).message);
      return false;
    }
  }
}
