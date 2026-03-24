/**
 * Uniswap Smart Order Router Adapter — DISABLED
 *
 * The @uniswap/smart-order-router package was removed to reduce Docker image size
 * and avoid OOM failures during CI builds. This stub always returns unsupported
 * so the system falls through to the next provider (Thirdweb).
 *
 * The Trading API adapter (uniswap-trading-api) covers the same use cases when
 * a UNISWAP_TRADING_API_KEY is configured.
 */

import { ISwapProvider, RouteParams, PreparedSwap } from '../../domain/ports/swap.provider.port';
import { SwapQuote, SwapRequest, TransactionStatus } from '../../domain/entities/swap';

export class UniswapSmartRouterAdapter implements ISwapProvider {
  public readonly name = 'uniswap-smart-router';

  constructor() {
    console.log(`[${this.name}] Smart Order Router disabled — use uniswap-trading-api or thirdweb`);
  }

  async supportsRoute(_params: RouteParams): Promise<boolean> {
    return false;
  }

    // Check if chain is supported
    if (!this.supportedChains.includes(fromChainId)) {
      return false;
    }

    // Check if router is initialized for this chain
    if (!this.routers.has(fromChainId)) {
      return false;
    }

    try {
      resolveToken('uniswap', fromChainId, params.fromToken);
      resolveToken('uniswap', toChainId, params.toToken);
      return true;
    } catch (error) {
      const fromResolvable =
        this.isNativeToken(params.fromToken) || ethers.utils.isAddress(params.fromToken);
      const toResolvable =
        this.isNativeToken(params.toToken) || ethers.utils.isAddress(params.toToken);
      const canFallback = fromResolvable && toResolvable;

      if (canFallback) {
        console.log(
          `[${this.name}] Token not found in registry for chain ${fromChainId}, will attempt on-chain metadata lookup`
        );
        return true;
      }

      console.log(
        `[${this.name}] Token unsupported on chain ${fromChainId}:`,
        (error as Error).message
      );
      return false;
    }
  }

  /**
   * Get swap quote using AlphaRouter
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    const { fromChainId, toChainId, fromToken: fromTokenAddr, toToken: toTokenAddr, amount, sender } = request;

    // Validate same-chain
    if (fromChainId !== toChainId) {
      throw new Error(`[${this.name}] Cross-chain swaps not supported. Use Thirdweb for cross-chain.`);
    }

    const chainId = fromChainId;

    // Get router for chain
    const router = this.routers.get(chainId);
    if (!router) {
      throw new Error(`[${this.name}] Chain ${chainId} not supported or router not initialized`);
    }

    const chainConfig = CHAIN_CONFIGS[chainId];
    if (!chainConfig) {
      throw new Error(`[${this.name}] Chain config not found for ${chainId}`);
    }

    console.log(`[${this.name}] 📊 Getting quote for ${amount.toString()} ${fromTokenAddr} → ${toTokenAddr} on chain ${chainId}`);

    try {
      // Create Token instances
      const provider = this.providers.get(chainId)!;
      const tokenIn = await this.createToken(chainId, fromTokenAddr, provider, chainConfig);
      const tokenOut = await this.createToken(chainId, toTokenAddr, provider, chainConfig);

      // Create amount - convert bigint to string for CurrencyAmount
      const amountIn = CurrencyAmount.fromRawAmount(tokenIn, amount.toString());

      console.log(`[${this.name}] Routing ${amountIn.toFixed()} ${tokenIn.symbol} → ${tokenOut.symbol}...`);
      console.log(`[${this.name}] Using slippage tolerance: ${this.slippageBps / 100}% (${this.slippageBps} bps)`);

      // Get route from AlphaRouter
      // AlphaRouter automatically searches both V2 and V3 pools by default
      const route = await router.route(
        amountIn,
        tokenOut,
        TradeType.EXACT_INPUT,
        {
          recipient: sender,
          slippageTolerance: new Percent(this.slippageBps, 10_000), // Configurable slippage
          deadline: Math.floor(Date.now() / 1000 + 3600), // 60 minutes - longer deadline for safety
          type: SwapType.SWAP_ROUTER_02
        }
      );

      if (!route) {
        throw new Error('No route found');
      }

      console.log(`[${this.name}] ✅ Quote: ${route.quote.toFixed()} ${tokenOut.symbol}`);
      console.log(`[${this.name}] Gas estimate: ${route.estimatedGasUsed.toString()}`);

      // Convert to SwapQuote entity
      const estimatedReceiveAmount = BigInt(route.quote.quotient.toString());
      const exchangeRate = parseFloat(route.quote.toFixed()) / parseFloat(amountIn.toFixed());
      const paddedGasLimit = this.applyGasBuffer(route.estimatedGasUsed);
      const gasPriceWei = route.gasPriceWei ?? BigNumber.from(0);
      const gasFeeWei = paddedGasLimit.mul(gasPriceWei);

      return new SwapQuote(
        estimatedReceiveAmount,
        0n, // bridgeFee - no bridge for same-chain
        BigInt(gasFeeWei.toString()),
        exchangeRate,
        15 // estimatedDuration - typical Uniswap swap time in seconds
      );
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(`[${this.name}] ❌ Quote failed:`, errorMsg);

      // Check for V2_TOO_LITTLE_RECEIVED error (0x7939f424)
      if (errorMsg.includes('0x7939f424') || errorMsg.includes('V2_TOO_LITTLE_RECEIVED')) {
        throw new Error(
          `[${this.name}] Slippage tolerance too low (current: ${this.slippageBps / 100}%). ` +
          `Increase UNISWAP_SLIPPAGE_BPS env variable (e.g., 300 for 3%, 500 for 5%).`
        );
      }

      throw new Error(`[${this.name}] Failed to get quote: ${errorMsg}`);
    }
  }

  /**
   * Prepare swap transaction using AlphaRouter
   * Returns PreparedSwap with transactions in the expected format
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    const { fromChainId, toChainId, fromToken: fromTokenAddr, toToken: toTokenAddr, amount, sender } = request;

    // Validate same-chain
    if (fromChainId !== toChainId) {
      throw new Error(`[${this.name}] Cross-chain swaps not supported. Use Thirdweb for cross-chain.`);
    }

    const chainId = fromChainId;

    // Get router for chain
    const router = this.routers.get(chainId);
    if (!router) {
      throw new Error(`[${this.name}] Chain ${chainId} not supported or router not initialized`);
    }

    const chainConfig = CHAIN_CONFIGS[chainId];
    if (!chainConfig) {
      throw new Error(`[${this.name}] Chain config not found for ${chainId}`);
    }

    console.log(`[${this.name}] 🔧 Preparing swap for ${amount.toString()} ${fromTokenAddr} → ${toTokenAddr} on chain ${chainId}`);

    try {
      // Create Token instances
      const provider = this.providers.get(chainId)!;
      const tokenIn = await this.createToken(chainId, fromTokenAddr, provider, chainConfig);
      const tokenOut = await this.createToken(chainId, toTokenAddr, provider, chainConfig);

      // Create amount - convert bigint to string for CurrencyAmount
      const amountIn = CurrencyAmount.fromRawAmount(tokenIn, amount.toString());

      console.log(`[${this.name}] Routing ${amountIn.toFixed()} ${tokenIn.symbol} → ${tokenOut.symbol}...`);
      console.log(`[${this.name}] Using slippage tolerance: ${this.slippageBps / 100}% (${this.slippageBps} bps)`);

      // Get route from AlphaRouter
      // AlphaRouter automatically searches both V2 and V3 pools by default
      const route = await router.route(
        amountIn,
        tokenOut,
        TradeType.EXACT_INPUT,
        {
          recipient: sender,
          slippageTolerance: new Percent(this.slippageBps, 10_000), // Configurable slippage
          deadline: Math.floor(Date.now() / 1000 + 3600), // 60 minutes - longer deadline for safety
          type: SwapType.SWAP_ROUTER_02
        }
      );

      if (!route || !route.methodParameters) {
        throw new Error('No route found or method parameters missing');
      }

      console.log(`[${this.name}] ✅ Swap prepared successfully`);

      // Convert to transaction format compatible with our system
      const paddedGasLimit = this.applyGasBuffer(route.estimatedGasUsed);
      const gasPriceWei = route.gasPriceWei ?? BigNumber.from(0);

      console.log(`[${this.name}] 📋 Swap details:`, {
        slippage: `${this.slippageBps / 100}%`,
        minAmountOut: route.quote.quotient.toString(),
        gasLimit: paddedGasLimit.toString(),
        to: route.methodParameters.to,
        value: route.methodParameters.value,
        hasRoute: !!route.route,
        routeLength: route.route?.length
      });

      const transactions: PreparedSwap['transactions'] = [];

      // For ERC20 inputs, ALWAYS include approval transaction
      // This ensures the frontend can handle approval properly, even if allowance exists
      if (!this.isNativeToken(fromTokenAddr)) {
        const approveAbi = [
          'function approve(address spender, uint256 amount) returns (bool)'
        ];

        try {
          const approveInterface = new ethers.utils.Interface(approveAbi);
          const approveCalldata = approveInterface.encodeFunctionData('approve', [
            route.methodParameters.to,
            ethers.constants.MaxUint256
          ]);

          transactions.push({
            to: tokenIn.address,
            data: approveCalldata,
            value: '0',
            chainId,
            gasLimit: BigNumber.from(60_000).toString(),
            feeMode: 'advisory' as const,
          });

          console.log(
            `[${this.name}] ✅ Added approval transaction for ${tokenIn.symbol} -> ${route.methodParameters.to}`
          );
        } catch (encodeError) {
          console.error(
            `[${this.name}] ❌ Unable to encode approval transaction:`,
            (encodeError as Error).message
          );
          throw new Error(`Failed to prepare approval transaction: ${(encodeError as Error).message}`);
        }
      }

      const swapTx = {
        to: route.methodParameters.to,
        data: route.methodParameters.calldata,
        value: route.methodParameters.value,
        chainId: chainId,
        gasLimit: paddedGasLimit.toString(),
        maxFeePerGas: gasPriceWei.gt(0) ? gasPriceWei.toString() : undefined,
        maxPriorityFeePerGas: gasPriceWei.gt(0) ? gasPriceWei.toString() : undefined,
        feeMode: 'advisory' as const,
      };

      transactions.push(swapTx);

      return {
        provider: this.name,
        transactions,
        estimatedDuration: 15, // Typical Uniswap swap time in seconds
        metadata: {
          quote: route.quote.toFixed(),
          estimatedGasUsed: route.estimatedGasUsed.toString(),
          gasPriceWei: gasPriceWei.toString(),
          slippageTolerance: `${this.slippageBps / 100}%`,
          slippageBps: this.slippageBps,
          routerAddress: route.methodParameters.to,
          // Hint for frontend: do not simulate, this transaction is pre-validated
          skipSimulation: true
        }
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(`[${this.name}] ❌ Prepare swap failed:`, errorMsg);

      // Check for V2_TOO_LITTLE_RECEIVED error (0x7939f424)
      if (errorMsg.includes('0x7939f424') || errorMsg.includes('V2_TOO_LITTLE_RECEIVED')) {
        throw new Error(
          `[${this.name}] Slippage tolerance too low (current: ${this.slippageBps / 100}%). ` +
          `Increase UNISWAP_SLIPPAGE_BPS env variable (e.g., 300 for 3%, 500 for 5%).`
        );
      }

      throw new Error(`[${this.name}] Failed to prepare swap: ${errorMsg}`);
    }
  }

  /**
   * Monitor transaction status
   * For Uniswap swaps, we check the transaction receipt on-chain
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`[${this.name}] Chain ${chainId} not supported`);
    }

    try {
      console.log(`[${this.name}] 🔍 Monitoring transaction ${txHash} on chain ${chainId}`);

      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        // Transaction not found or still pending
        const tx = await provider.getTransaction(txHash);
        if (tx) {
          return TransactionStatus.PENDING;
        } else {
          return TransactionStatus.FAILED; // Transaction not found
        }
      }

      // Check if transaction was successful
      if (receipt.status === 1) {
        console.log(`[${this.name}] ✅ Transaction ${txHash} completed successfully`);
        return TransactionStatus.COMPLETED;
      } else {
        console.log(`[${this.name}] ❌ Transaction ${txHash} failed`);
        return TransactionStatus.FAILED;
      }
    } catch (error) {
      console.error(`[${this.name}] ❌ Error monitoring transaction:`, (error as Error).message);
      return TransactionStatus.FAILED;
    }
  }

  /**
   * Create Token instance from address
   * Handles both ERC20 tokens and native tokens
   */
  private async createToken(
    chainId: number,
    address: string,
    provider: ethers.providers.JsonRpcProvider,
    chainConfig: ChainConfig
  ): Promise<Token> {
    const cacheKey = this.getTokenCacheKey(chainId, address);
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Handle native token
    if (this.isNativeToken(address)) {
      // Return wrapped native token for routing
      const { address: wrappedAddr, symbol, decimals, name } = chainConfig.wrappedNativeToken;
      const token = new Token(chainId, wrappedAddr, decimals, symbol, name);
      this.tokenCache.set(cacheKey, token);
      return token;
    }

    // Try registry metadata first to avoid unnecessary RPC calls
    try {
      const registryToken = resolveToken('uniswap', chainId, address);
      const { metadata } = registryToken;
      const token = new Token(
        chainId,
        metadata.address,
        metadata.decimals,
        metadata.symbol,
        metadata.name
      );
      this.tokenCache.set(cacheKey, token);
      return token;
    } catch (registryError) {
      console.warn(
        `[${this.name}] Registry metadata lookup failed for ${address} on chain ${chainId}:`,
        (registryError as Error).message
      );
      // fall back to on-chain lookup
    }

    // Handle ERC20 token - fetch metadata
    try {
      const tokenContract = new ethers.Contract(
        address,
        [
          'function symbol() view returns (string)',
          'function decimals() view returns (uint8)',
          'function name() view returns (string)'
        ],
        provider
      );

      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name()
      ]);

      const token = new Token(chainId, address, decimals, symbol, name);
      this.tokenCache.set(cacheKey, token);
      return token;
    } catch (error) {
      console.error(`[${this.name}] Failed to fetch token metadata for ${address}:`, (error as Error).message);
      // Fallback: assume standard ERC20 with 18 decimals
      const fallback = new Token(chainId, address, 18, 'UNKNOWN', 'Unknown Token');
      this.tokenCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  /**
   * Check if address is native token
   */
  private isNativeToken(address: string): boolean {
    const normalized = address.toLowerCase();
    return (
      normalized === 'native' ||
      normalized === NATIVE_TOKEN_ADDRESS.toLowerCase() ||
      normalized === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
  }

  /**
   * Normalize token address for consistent format
   */
  private normalizeTokenAddress(address: string): string {
    if (this.isNativeToken(address)) {
      return 'native';
    }
    return address;
  }

  private getTokenCacheKey(chainId: number, address: string): string {
    return `${chainId}:${this.normalizeTokenAddress(address).toLowerCase()}`;
  }

  private applyGasBuffer(estimate: BigNumber): BigNumber {
    const padded = estimate.mul(this.gasBufferBps).div(10_000);
    const minimumHeadroom = BigNumber.from(25_000);
    if (padded.sub(estimate).lt(minimumHeadroom)) {
      return estimate.add(minimumHeadroom);
    }
    return padded;
  }
}
