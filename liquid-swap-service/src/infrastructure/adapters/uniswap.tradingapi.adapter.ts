/**
 * Uniswap Trading API Adapter
 *
 * Official Uniswap REST API integration for optimal same-chain swaps.
 *
 * Features:
 * - Auto-routing between V2/V3/V4/UniswapX
 * - Permit2 support (gasless approvals)
 * - Precise gas estimation
 * - Retry logic with exponential backoff
 * - Structured error handling
 *
 * API Documentation: https://docs.uniswap.org/contracts/trading-api/overview
 *
 * @see https://trade-api.gateway.uniswap.org/v1/api.json
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from '../../domain/ports/swap.provider.port';
import { SwapRequest, SwapQuote, TransactionStatus } from '../../domain/entities/swap';
import {
  SwapError,
  SwapErrorCode,
  createNoRouteError,
  createRateLimitError,
  createTimeoutError,
  createProviderError,
} from '../../domain/entities/errors';

// ===== TYPE DEFINITIONS (from Uniswap API) =====

interface UniswapTokenInfo {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logoURI?: string;
}

interface RouteHop {
  type: 'v2-pool' | 'v3-pool' | 'v4-pool';
  address: string;
  tokenIn: UniswapTokenInfo;
  tokenOut: UniswapTokenInfo;
  fee?: string; // V3/V4 only (e.g., "500" = 0.05%)
  sqrtPriceX96?: string;
  liquidity?: string;
}

interface GasEstimate {
  gasLimit: string;
  maxFeePerGas: string; // Wei
  maxPriorityFeePerGas: string; // Wei
  estimatedCostWei: string;
}

interface QuoteOutput {
  amount?: string;
  token?: string;
  recipient?: string;
}

interface AggregatedOutput {
  amount?: string;
  token?: string;
  recipient?: string;
  bps?: number;
  minAmount?: string;
}

interface UniswapQuoteResponse {
  quote: {
    amount?: string; // Output amount in token units
    priceImpact?: string; // e.g., "0.15" = 0.15%
    exchangeRate?: string; // e.g., "3000.50"
    output?: QuoteOutput;
    aggregatedOutputs?: AggregatedOutput[];
    gasFee?: string;
    gasFeeQuote?: string;
    quoteId?: string; // Unique identifier for the quote
    slippage?: number; // Slippage tolerance (e.g., 5 = 5%)
    expiresAt?: number; // Unix timestamp when quote expires
  };
  route?: RouteHop[];
  gasEstimate?: GasEstimate;
  expiresAt?: number; // Unix timestamp
  slippage?: string;
  gasPriceWei?: string;
  permitData?: Record<string, unknown>;
  permitTransaction?: UniswapPreparedTransaction | null; // On-chain permit approval (when generatePermitAsTransaction=true)
  permitGasFee?: string; // Gas fee for permit transaction
}

interface UniswapPreparedTransaction {
  chainId: number;
  to: string; // Universal Router address
  from: string;
  data: string; // Calldata
  value: string; // Wei to send (0 for ERC20, amount for native ETH)
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

interface UniswapCreateResponse {
  swap: {
    to: string;
    data: string;
    value: string;
    chainId: number | string;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  gasFee?: string;
  requestId?: string;
  quote?: UniswapQuoteResponse;
  route?: RouteHop[];
  expiresAt?: number;
}

interface UniswapApprovalRequest {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
  includeGasInfo?: boolean;
  // Optional: Destination token for Permit2 validation context
  tokenOut?: string;
  tokenOutChainId?: number;
}

interface UniswapApprovalResponse {
  approval: UniswapPreparedTransaction | null;
  cancel: UniswapPreparedTransaction | null;
  gasFee?: string;
  cancelGasFee?: string;
  requestId?: string;
}

// ===== CONFIGURATION =====

interface UniswapTradingApiConfig {
  apiUrl: string;
  apiKey: string;
  timeout: number; // ms
  maxRetries: number;
  retryDelay: number; // ms (base delay for exponential backoff)
}

// ===== ADAPTER IMPLEMENTATION =====

export class UniswapTradingApiAdapter implements ISwapProvider {
  public readonly name = 'uniswap-trading-api';
  private readonly client: AxiosInstance;
  private readonly config: UniswapTradingApiConfig;
  private readonly slippageTolerance?: number;
  private readonly quoteCacheEnabled: boolean;

  // Quote cache to reuse between getQuote() and prepareSwap()
  // Key format: `${chainId}:${fromToken}:${toToken}:${amount}:${sender}`
  private readonly quoteCache = new Map<string, {
    quote: any;
    timestamp: number;
    expiresAt: number;
  }>();
  private readonly quoteCacheTTL = 60000; // 60 seconds

  // Supported chains (from Uniswap docs)
  private readonly supportedChains: number[] = [
    1,       // Ethereum
    10,      // Optimism
    56,      // BSC
    137,     // Polygon
    8453,    // Base
    42161,   // Arbitrum
    42220,   // Celo
    43114,   // Avalanche
  ];

  constructor(config?: Partial<UniswapTradingApiConfig>) {
    // Load configuration
    this.config = {
      apiUrl: process.env.UNISWAP_API_URL || 'https://trade-api.gateway.uniswap.org',
      apiKey: process.env.UNISWAP_API_KEY || '',
      timeout: 10000, // 10 seconds
      maxRetries: 3,
      retryDelay: 1000, // 1 second base delay
      ...config,
    };


    if (!this.config.apiKey) {
      console.warn('[UniswapTradingApiAdapter] ⚠️ No API key configured. Set UNISWAP_API_KEY env var.');
    }

    this.slippageTolerance = this.normalizeConfiguredSlippage(process.env.UNISWAP_TRADING_API_SLIPPAGE);
    console.log(
      `[${this.name}] 📊 Slippage tolerance: ${
        this.slippageTolerance !== undefined ? this.slippageTolerance : 'provider-default'
      }`
    );

    // Quotes must not be cached by default (trust-first UX). Enable explicitly if needed.
    this.quoteCacheEnabled = String(process.env.ENABLE_QUOTE_CACHE || '').toLowerCase() === 'true';
    if (!this.quoteCacheEnabled) {
      console.log(`[${this.name}] 🧊 Quote cache disabled (set ENABLE_QUOTE_CACHE=true to enable)`);
    }

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'User-Agent': 'PanoramaBlock-LiquidSwap/1.0',
      },
    });

    // Request interceptor (logging)
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[${this.name}] → ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error(`[${this.name}] Request error:`, error.message);
        return Promise.reject(error);
      }
    );

    // Response interceptor (logging)
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[${this.name}] ← ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          console.error(`[${this.name}] ← ${error.response.status} ${error.config?.url}`, error.response.data);
        } else {
          console.error(`[${this.name}] Network error:`, error.message);
        }
        return Promise.reject(error);
      }
    );

    console.log(`[${this.name}] ✅ Initialized for chains: ${this.supportedChains.join(', ')}`);
  }

  // ===== INTERFACE IMPLEMENTATION =====

  /**
   * Check if this provider supports a given route
   *
   * Uniswap Trading API only supports same-chain swaps
   */
  async supportsRoute(params: RouteParams): Promise<boolean> {
    // Only same-chain
    if (params.fromChainId !== params.toChainId) {
      return false;
    }

    // Check if chain is supported
    return this.supportedChains.includes(params.fromChainId);
  }

  /**
   * Get swap quote from Uniswap Trading API
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    const endpoint = '/quote';

    try {
      console.log(`[${this.name}] 📊 Getting quote for ${request.toLogString()}`);

      // Validate same-chain
      if (request.fromChainId !== request.toChainId) {
        throw new SwapError(
          SwapErrorCode.INVALID_CHAIN,
          'Uniswap Trading API only supports same-chain swaps. Use Thirdweb for cross-chain.',
          { fromChainId: request.fromChainId, toChainId: request.toChainId }
        );
      }

      // Build request payload
      const slippageTolerance = this.resolveTradingApiSlippageTolerance();
      const payload = {
        tokenIn: this.normalizeTokenAddress(request.fromToken),
        tokenOut: this.normalizeTokenAddress(request.toToken),
        amount: request.amount.toString(),
        type: 'EXACT_INPUT',
        tokenInChainId: request.fromChainId,
        tokenOutChainId: request.toChainId,
        swapper: request.sender, // Required field
        enableUniversalRouter: true,
        simulateTransaction: false, // Disable simulation - let the wallet handle it
        // CRITICAL: Force Permit2 to be returned as on-chain transaction
        // instead of requiring off-chain signature (which we can't provide server-side)
        generatePermitAsTransaction: true,
      };
      if (slippageTolerance !== undefined) {
        (payload as Record<string, unknown>).slippageTolerance = slippageTolerance;
      }

      console.log(
        `[${this.name}] Using slippage tolerance: ${
          slippageTolerance !== undefined ? slippageTolerance : 'provider-default'
        }`
      );

      // Call API with retry
      const response = await this.retryRequest<UniswapQuoteResponse>(
        () => this.client.post(endpoint, payload)
      );

      const routeTypes = Array.isArray(response?.route)
        ? response.route.map((h) => h?.type).filter(Boolean)
        : [];

      // CRITICAL DEBUG: Log full quote structure to understand API response
      console.log(`[${this.name}] 🔍 FULL QUOTE RESPONSE:`, JSON.stringify(response, null, 2));

      console.log(`[${this.name}] ✅ Quote received:`, {
        outputAmount: response.quote?.amount,
        output: response.quote?.output,
        aggregatedOutputs: response.quote?.aggregatedOutputs,
        priceImpact: response.quote?.priceImpact,
        route: routeTypes,
        quoteId: response.quote?.quoteId,
      });


      return this.mapToSwapQuote(response, request);

    } catch (error) {
      throw this.handleError(error, 'getQuote');
    }
  }

  /**
   * Check if token approval is needed
   *
   * CRITICAL: Must include tokenOut and tokenOutChainId for Permit2 context.
   * The Universal Router uses Permit2 which needs to validate the approval
   * against the specific swap route (tokenIn -> tokenOut).
   */
  private async checkApproval(request: SwapRequest): Promise<UniswapApprovalResponse | null> {
    // Native tokens (ETH, MATIC, etc.) don't need approval
    if (this.isNativeToken(request.fromToken)) {
      console.log(`[${this.name}] ⏭️ Skipping approval check for native token`);
      return null;
    }

    try {
      console.log(`[${this.name}] 🔍 Checking token approval with full swap context...`);

      const approvalRequest: any = {
        walletAddress: request.sender,
        token: this.normalizeTokenAddress(request.fromToken),
        amount: request.amount.toString(),
        chainId: request.fromChainId,
        includeGasInfo: true,
        // CRITICAL: Include destination token for Permit2 validation
        tokenOut: this.normalizeTokenAddress(request.toToken),
        tokenOutChainId: request.toChainId,
      };

      console.log(`[${this.name}] 📤 Approval request:`, {
        token: approvalRequest.token,
        tokenOut: approvalRequest.tokenOut,
        amount: approvalRequest.amount,
        chainId: approvalRequest.chainId,
      });

      const approvalResponse = await this.retryRequest<UniswapApprovalResponse>(
        () => this.client.post('/check_approval', approvalRequest)
      );

      // Log FULL approval response for debugging
      console.log(`[${this.name}] 🔍 FULL APPROVAL RESPONSE:`, JSON.stringify(approvalResponse, null, 2));

      console.log(`[${this.name}] ✅ Approval check result:`, {
        needsApproval: !!approvalResponse.approval,
        needsCancel: !!approvalResponse.cancel,
        hasRequestId: !!approvalResponse.requestId,
      });

      // Log approval transaction details if present
      if (approvalResponse.approval) {
        console.log(`[${this.name}] 📝 Approval transaction required:`, {
          to: approvalResponse.approval.to,
          hasData: !!approvalResponse.approval.data,
          value: approvalResponse.approval.value,
          gasFee: approvalResponse.gasFee,
        });
      }

      if (approvalResponse.cancel) {
        console.log(`[${this.name}] ⚠️ Cancel transaction required (token needs reset):`, {
          to: approvalResponse.cancel.to,
          hasData: !!approvalResponse.cancel.data,
          value: approvalResponse.cancel.value,
          cancelGasFee: approvalResponse.cancelGasFee,
        });
      }

      return approvalResponse;
    } catch (error) {
      console.error(`[${this.name}] ❌ Approval check failed:`, (error as Error).message);
      // Log full error for debugging
      console.error(`[${this.name}] Full error:`, error);
      // Continue without approval check - let the swap attempt and fail with better error message
      return null;
    }
  }

  /**
   * Prepare swap transactions (with approval if needed)
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    const endpoint = '/swap';

    try {
      console.log(`[${this.name}] 🔧 Preparing swap for ${request.toLogString()}`);

      // Step 1: Check if approval is needed
      const approvalCheck = await this.checkApproval(request);

      // Step 2: ALWAYS get a fresh quote (cache disabled due to inconsistencies)
      // Previously: We tried to reuse cached quotes, but this caused permitTransaction
      // mismatches between /quote (user-facing) and /swap (execution)
      console.log(`[${this.name}] Fetching fresh quote for prepare...`);

      // Build request payload
      const slippageTolerance = this.resolveTradingApiSlippageTolerance();
      const payload = {
        tokenIn: this.normalizeTokenAddress(request.fromToken),
        tokenOut: this.normalizeTokenAddress(request.toToken),
        amount: request.amount.toString(),
        type: 'EXACT_INPUT',
        tokenInChainId: request.fromChainId,
        tokenOutChainId: request.toChainId,
        swapper: request.sender,
        recipient: request.receiver !== request.sender ? request.receiver : undefined,
        enableUniversalRouter: true,
        simulateTransaction: false, // Disable simulation - let the wallet handle it
        // CRITICAL: Force Permit2 to be returned as on-chain transaction
        generatePermitAsTransaction: true,
      };
      if (slippageTolerance !== undefined) {
        (payload as Record<string, unknown>).slippageTolerance = slippageTolerance;
      }

      console.log(
        `[${this.name}] Preparing swap with slippage tolerance: ${
          slippageTolerance !== undefined ? slippageTolerance : 'provider-default'
        }`
      );

      const quoteResponse = await this.retryRequest<UniswapQuoteResponse>(
        () => this.client.post('/quote', payload)
      );

      if (!quoteResponse?.quote) {
        throw new SwapError(
          SwapErrorCode.PROVIDER_ERROR,
          'Uniswap Trading API returned an empty quote',
          { rawResponse: quoteResponse },
          502
        );
      }

      // Extract minAmount from quote for validation
      const quoteMinAmount = quoteResponse.quote?.aggregatedOutputs?.[0]?.minAmount;

      console.log(`[${this.name}] ✅ Quote for prepare received`, {
        amount: quoteResponse.quote?.amount,
        output: quoteResponse.quote?.output?.amount,
        minAmount: quoteMinAmount,
        quoteId: (quoteResponse.quote as any)?.quoteId,
        slippage: quoteResponse.quote?.slippage,
        hasPermitTransaction: !!quoteResponse.permitTransaction,
        hasPermitData: !!quoteResponse.permitData,
      });

      // Step 3: Prepare swap transaction
      // CRITICAL: Send the complete quote object to the /swap endpoint
      // The API requires the full quote for validation and execution
      const quoteId = (quoteResponse.quote as any)?.quoteId;

      if (!quoteId) {
        throw new SwapError(
          SwapErrorCode.PROVIDER_ERROR,
          'Quote response missing quoteId',
          { quote: quoteResponse.quote },
          502
        );
      }

      // Build swap payload with ONLY the required fields
      // CRITICAL: Do NOT send permitData as it requires user signature
      // Deep clone the quote to remove any permitData references
      const cleanQuote = JSON.parse(JSON.stringify(quoteResponse.quote));

      // Explicitly remove permitData if it exists
      if (cleanQuote.permitData) {
        delete cleanQuote.permitData;
        console.log(`[${this.name}] 🗑️ Removed permitData from quote`);
      }

      const swapPayload = {
        quote: cleanQuote,
        simulateTransaction: false,
      };

      console.log(`[${this.name}] 📤 Sending swap request with quoteId: ${quoteId}`);

      // DEBUG: Verify no permitData in final payload
      const payloadStr = JSON.stringify(swapPayload);
      if (payloadStr.includes('permitData')) {
        console.error(`[${this.name}] ❌ CRITICAL: permitData still in payload!`);
        throw new SwapError(
          SwapErrorCode.PROVIDER_ERROR,
          'Cannot prepare swap: permitData requires user signature which is not available server-side',
          { hasPermitData: true },
          400
        );
      }

      console.log(`[${this.name}] ✅ Payload validated (no permitData)`);

      const response = await this.retryRequest<UniswapCreateResponse>(
        () => this.client.post(endpoint, swapPayload)
      );

      // DEBUG: Log full response structure
      console.log(`[${this.name}] 🔍 Full swap response:`, {
        hasSwap: !!response?.swap,
        hasQuote: !!response?.quote,
        hasRoute: !!response?.route,
        hasGasFee: !!response?.gasFee,
        hasRequestId: !!response?.requestId,
        responseKeys: response ? Object.keys(response) : [],
      });

      const swapTx = response?.swap;

      if (!swapTx) {
        console.error(`[${this.name}] ❌ No swap transaction in response`);
        throw new SwapError(
          SwapErrorCode.NO_ROUTE_FOUND,
          "Uniswap Trading API returned no swap transaction",
          { swapResponse: response },
          502
        );
      }

      console.log(`[${this.name}] ✅ Swap transaction received:`, {
        to: swapTx.to,
        value: swapTx.value,
        valueInETH: swapTx.value !== '0x00' ? `${BigInt(swapTx.value) / BigInt(1e18)} ETH` : '0',
        hasData: !!swapTx.data,
        dataLength: swapTx.data?.length,
        chainId: swapTx.chainId,
        gasLimit: swapTx.gasLimit,
        maxFeePerGas: swapTx.maxFeePerGas,
        maxPriorityFeePerGas: swapTx.maxPriorityFeePerGas,
        isNativeSwap: this.isNativeToken(request.fromToken),
      });

      // Log full transaction data for debugging
      console.log(`[${this.name}] 🔍 FULL SWAP TX DATA:`, JSON.stringify({
        to: swapTx.to,
        data: swapTx.data?.substring(0, 200) + '...',
        value: swapTx.value,
        chainId: swapTx.chainId,
        gasLimit: swapTx.gasLimit,
      }, null, 2));

      // Decode the function selector to understand what's being called
      if (swapTx.data) {
        const selector = swapTx.data.substring(0, 10);
        const selectorNames: Record<string, string> = {
          '0x3593564c': 'execute(bytes,bytes[],uint256)', // Universal Router
          '0x24856bc3': 'execute(bytes,bytes[])',
          '0xabb979b9': 'multicall(bytes[])',
        };
        console.log(`[${this.name}] 🔍 Function selector: ${selector} (${selectorNames[selector] || 'unknown'})`);
      }

      // Use calldata EXACTLY as returned by Uniswap API - no modifications
      console.log(`[${this.name}] ✅ Using calldata exactly as returned by Uniswap API`);

      // Step 4: Build transactions array
      const transactions: Transaction[] = [];

      // Add cancel approval if needed (some tokens require reset)
      if (approvalCheck?.cancel) {
        console.log(`[${this.name}] 📝 Adding cancel approval transaction`);
        transactions.push(this.mapTransaction(approvalCheck.cancel, 'Cancel previous approval'));
      }

      // CRITICAL: Prefer check_approval over permitTransaction
      // They both return Permit2 approval, but check_approval is more accurate
      // as it checks the actual on-chain state
      if (approvalCheck?.approval) {
        console.log(`[${this.name}] 📝 Adding approval transaction from check_approval`);
        transactions.push(this.mapTransaction(approvalCheck.approval, 'Approve token'));
      } else if (!this.isNativeToken(request.fromToken)) {
        // API says no approval needed for ERC-20 token
        // This means the wallet already has sufficient approval
        console.log(`[${this.name}] ✅ Wallet already has sufficient approval for ${request.fromToken}`);
        console.log(`[${this.name}] ℹ️ Skipping approval transaction - proceeding directly to swap`);
      }

      // Add swap transaction - use EXACT gas limit from Uniswap API
      console.log(`[${this.name}] 📝 Adding swap transaction`);
      console.log(`[${this.name}] 📝 Using exact gas limit from API: ${swapTx.gasLimit}`);
      transactions.push(this.mapTransaction(swapTx, 'Execute swap'));

      if (transactions.length === 0) {
        console.error(`[${this.name}] ❌ No transactions found in response:`,
          JSON.stringify(response, null, 2)
        );
        throw new SwapError(
          SwapErrorCode.NO_ROUTE_FOUND,
          "Uniswap Trading API returned no executable transactions",
          {
            quote: quoteResponse.quote,
            swapResponse: response,
          },
          502
        );
      }

      return {
        provider: this.name,
        transactions,
        estimatedDuration: 30, // Typical swap time in seconds
        expiresAt: response?.expiresAt ? new Date(response.expiresAt * 1000) : undefined,
        metadata: {
          quote: response.quote,
          route: response.route,
          gasFee: response.gasFee,
          slippageTolerance: this.resolveTradingApiSlippageTolerance() ?? "provider-default",
          minAmountOut: quoteMinAmount,
          providerDebug: {
            quoteId,
            approvalRequestId: approvalCheck?.requestId,
            swapRequestId: response?.requestId,
            approvalSkipped: !approvalCheck?.approval && !approvalCheck?.cancel && !this.isNativeToken(request.fromToken),
            needsApproval: Boolean(approvalCheck?.approval),
            needsApprovalCancel: Boolean(approvalCheck?.cancel),
            requestedSlippageTolerance: slippageTolerance ?? 'provider-default',
            quoteSlippage: quoteResponse.quote?.slippage,
            quoteOutputAmount: quoteResponse.quote?.output?.amount,
            quoteMinAmount: quoteMinAmount,
            hasPermitTransaction: Boolean(quoteResponse.permitTransaction),
            hasPermitData: Boolean(quoteResponse.permitData),
          },
        },
      };

    } catch (error) {
      throw this.handleError(error, 'prepareSwap');
    }
  }

  /**
   * Monitor transaction status
   *
   * Note: Uniswap Trading API doesn't have a status endpoint.
   * We rely on RPC provider to check transaction receipt.
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> {
    // TODO: Implement RPC-based status check
    // For now, return PENDING
    console.log(`[${this.name}] 🔍 Monitoring transaction ${txHash} on chain ${chainId}`);
    return TransactionStatus.PENDING;
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Retry request with exponential backoff
   */
  private async retryRequest<T>(
    requestFn: () => Promise<any>,
    attempt: number = 1
  ): Promise<T> {
    try {
      const response = await requestFn();
      return response.data;

    } catch (error) {
      // Don't retry on client errors (4xx), except 429 (rate limit)
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;

        if (status >= 400 && status < 500 && status !== 429) {
          throw error; // Client error, don't retry
        }
      }

      // Retry on 5xx or 429 (rate limit)
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff

        console.warn(`[${this.name}] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);

        await this.sleep(delay);
        return this.retryRequest(requestFn, attempt + 1);
      }

      throw error; // Max retries exceeded
    }
  }

  /**
   * Error handling and mapping to SwapError
   */
  private handleError(error: unknown, operation: string): SwapError {
    console.error(`[${this.name}] ❌ Error in ${operation}:`, error);

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data;

        // Map Uniswap API error codes
        switch (data?.errorCode) {
          case 'VALIDATION_ERROR':
            return new SwapError(
              SwapErrorCode.INVALID_TOKEN_ADDRESS,
              data.detail || 'Invalid request parameters',
              { originalError: data },
              400
            );

          case 'NO_ROUTE_FOUND':
            return new SwapError(
              SwapErrorCode.NO_ROUTE_FOUND,
              'No route found for this swap',
              { originalError: data },
              404
            );

          case 'RATE_LIMIT_EXCEEDED':
            return createRateLimitError();

          default:
            return new SwapError(
              SwapErrorCode.PROVIDER_ERROR,
              data.detail || `Uniswap API error: ${status}`,
              { originalError: data, status },
              status
            );
        }
      }

      if (axiosError.request) {
        // Network error
        return new SwapError(
          SwapErrorCode.TIMEOUT,
          'Network error communicating with Uniswap API',
          { originalError: axiosError.message },
          503
        );
      }
    }

    // Unknown error
    return createProviderError(this.name, error as Error);
  }

  /**
   * Map Uniswap quote to domain SwapQuote entity
   */
  private mapToSwapQuote(response: UniswapQuoteResponse, request: SwapRequest): SwapQuote {
    const quote = response.quote ?? ({} as UniswapQuoteResponse['quote']);

    const outputAmountRaw =
      quote.amount ??
      quote.output?.amount ??
      quote.aggregatedOutputs?.[0]?.amount;

    if (!outputAmountRaw) {
      throw new SwapError(
        SwapErrorCode.PROVIDER_ERROR,
        'Uniswap Trading API returned an empty quote amount',
        { rawResponse: response },
        502
      );
    }

    const outputAmount = BigInt(outputAmountRaw);

    const gasFeeRaw =
      response.gasEstimate?.estimatedCostWei ??
      quote.gasFee ??
      quote.gasFeeQuote;
    const gasFee = gasFeeRaw ? BigInt(gasFeeRaw) : 0n;

    // Bridge fee (0 for same-chain swaps)
    const bridgeFee = 0n;

    // Exchange rate (already calculated by Uniswap)
    const exchangeRate =
      quote.exchangeRate !== undefined
        ? parseFloat(quote.exchangeRate)
        : parseFloat(outputAmountRaw) /
          parseFloat(request.amount.toString());

    // Estimated duration (typical same-chain swap)
    const estimatedDuration = 30; // seconds

    return new SwapQuote(
      outputAmount,
      bridgeFee,
      gasFee,
      exchangeRate,
      estimatedDuration
    );
  }

  /**
   * Map Uniswap transaction to our Transaction type
   */
  private mapTransaction(
    tx: {
      to: string;
      data: string;
      value: string | number;
      chainId: number | string;
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    },
    description?: string
  ): Transaction {
    return {
      chainId: typeof tx.chainId === 'string' ? Number(tx.chainId) : tx.chainId,
      to: tx.to,
      data: tx.data,
      value: typeof tx.value === 'string' ? tx.value : tx.value.toString(),
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      feeMode: 'advisory',
      description,
    };
  }

  /**
   * Check if token is native (ETH, MATIC, etc.)
   */
  private isNativeToken(address: string): boolean {
    const lower = address.toLowerCase();
    return (
      lower === 'native' ||
      lower === '0x0000000000000000000000000000000000000000' ||
      lower === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
  }

  /**
   * Normalize token address for API
   */
  private normalizeTokenAddress(address: string): string {
    // Native token keywords → 0xeeee...eeee (42 e's)
    if (this.isNativeToken(address)) {
      return '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    }

    return address;
  }

  private resolveTradingApiSlippageTolerance(): number | undefined {
    return this.slippageTolerance;
  }

  private normalizeConfiguredSlippage(rawValue?: string | number | null): number | undefined {
    if (typeof rawValue === 'number') {
      return Number.isFinite(rawValue) ? rawValue : undefined;
    }

    const normalized = String(rawValue || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();

    if (!normalized || normalized === 'auto' || normalized === 'provider-default') {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate cache key for quote
   */
  private getCacheKey(request: SwapRequest): string {
    return `${request.fromChainId}:${request.fromToken}:${request.toToken}:${request.amount}:${request.sender}`;
  }

  /**
   * Store quote in cache
   */
  private cacheQuote(request: SwapRequest, quoteResponse: any): void {
    if (!this.quoteCacheEnabled) return;
    const key = this.getCacheKey(request);
    const now = Date.now();

    // Extract expiresAt from quote if available
    const expiresAt = quoteResponse.quote?.expiresAt
      ? quoteResponse.quote.expiresAt * 1000 // Convert to ms
      : now + this.quoteCacheTTL;

    this.quoteCache.set(key, {
      quote: quoteResponse,
      timestamp: now,
      expiresAt: expiresAt,
    });

    console.log(`[${this.name}] 💾 Cached quote for ${this.quoteCacheTTL / 1000}s`, {
      key: key.substring(0, 50) + '...',
      expiresIn: Math.round((expiresAt - now) / 1000) + 's',
      quoteId: quoteResponse.quote?.quoteId,
    });
  }

  /**
   * Get cached quote if still valid
   */
  private getCachedQuote(request: SwapRequest): any | null {
    if (!this.quoteCacheEnabled) return null;
    const key = this.getCacheKey(request);
    const cached = this.quoteCache.get(key);

    if (!cached) {
      console.log(`[${this.name}] 📭 No cached quote found`);
      return null;
    }

    const now = Date.now();

    // Check if cache is expired
    if (now > cached.expiresAt) {
      console.log(`[${this.name}] ⏰ Cached quote expired`);
      this.quoteCache.delete(key);
      return null;
    }

    const ageSeconds = Math.round((now - cached.timestamp) / 1000);
    console.log(`[${this.name}] ✅ Using cached quote (age: ${ageSeconds}s)`, {
      quoteId: cached.quote?.quote?.quoteId,
    });

    return cached.quote;
  }

  /**
   * Clear expired quotes from cache (cleanup)
   */
  private cleanupCache(): void {
    if (!this.quoteCacheEnabled) return;
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.quoteCache.entries()) {
      if (now > value.expiresAt) {
        this.quoteCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[${this.name}] 🧹 Cleaned up ${cleaned} expired quotes from cache`);
    }
  }
}
