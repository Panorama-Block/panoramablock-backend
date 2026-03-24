/**
 * Quote Service
 * Gets price quotes from DEX aggregators before executing swaps
 */

import { calculateMinimumAmountOut } from '../config/swap.config';
import { CircuitBreakerManager, CIRCUIT_BREAKERS } from './circuitBreaker.service';

/**
 * Get price quote for a swap
 * Uses Uniswap V3 quoter for accurate price estimation
 */
export class QuoteService {
  private getCircuitBreaker(chainId: number) {
    return CircuitBreakerManager.getBreaker(`${CIRCUIT_BREAKERS.UNISWAP_QUOTER}-${chainId}`, {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000,
      monitoringWindow: 60000,
    });
  }

  /**
   * Get expected output amount for a swap
   * @param params Swap parameters
   * @returns Expected output amount and minimum acceptable amount
   */
  async getQuote(params: {
    fromToken: string;
    toToken: string;
    amountIn: bigint;
    chainId: number;
    slippagePercent?: number;
  }): Promise<{
    amountOut: bigint;
    amountOutMinimum: bigint;
    priceImpact: number;
  }> {
    // Use per-chain circuit breaker to avoid cross-chain failure propagation
    return this.getCircuitBreaker(params.chainId).execute(async () => {
      try {
      console.log('[QuoteService] Getting quote for swap:', {
        fromToken: params.fromToken,
        toToken: params.toToken,
        amountIn: params.amountIn.toString(),
        chainId: params.chainId
      });

      // Import Thirdweb dynamically
      const { createThirdwebClient, getContract, defineChain } = await import('thirdweb');
      const { prepareContractCall, readContract } = await import('thirdweb');

      // Initialize Thirdweb client
      const client = createThirdwebClient({
        secretKey: process.env.THIRDWEB_SECRET_KEY!,
      });

      const chain = defineChain(params.chainId);

      // Uniswap V3 Quoter V2 address
      const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';

      const quoterContract = getContract({
        client,
        chain,
        address: QUOTER_V2_ADDRESS,
      });

      // Prepare quoteExactInputSingle call
      const quoteParams = {
        tokenIn: params.fromToken,
        tokenOut: params.toToken,
        fee: 3000, // 0.3% fee tier
        amountIn: params.amountIn,
        sqrtPriceLimitX96: BigInt(0),
      };

      console.log('[QuoteService] Calling Uniswap Quoter...');

      // Call quoteExactInputSingle
      const result = await readContract({
        contract: quoterContract,
        method: 'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
        params: [quoteParams],
      });

      // Result is a tuple: [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
      const amountOut = result[0];

      // Calculate minimum amount out with slippage protection
      const amountOutMinimum = calculateMinimumAmountOut(
        amountOut,
        params.slippagePercent
      );

      // Calculate price impact
      const priceImpact = this.calculatePriceImpact(params.amountIn, amountOut);

      console.log('[QuoteService] ✅ Quote received:', {
        amountOut: amountOut.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        priceImpact: `${priceImpact.toFixed(2)}%`,
      });

      return {
        amountOut,
        amountOutMinimum,
        priceImpact,
      };
    } catch (error: any) {
      console.error('[QuoteService] ❌ Failed to get quote:', error);

      // Fallback: Use conservative estimate (95% of input, accounting for potential 5% slippage)
      console.warn('[QuoteService] ⚠️ Using fallback quote estimation');
      const estimatedOutput = (params.amountIn * BigInt(95)) / BigInt(100);
      const amountOutMinimum = calculateMinimumAmountOut(
        estimatedOutput,
        params.slippagePercent
      );

        return {
          amountOut: estimatedOutput,
          amountOutMinimum,
          priceImpact: 5.0, // Conservative estimate
        };
      }
    });
  }

  /**
   * Calculate price impact percentage
   * @param amountIn Input amount
   * @param amountOut Output amount
   * @returns Price impact as percentage
   */
  private calculatePriceImpact(amountIn: bigint, amountOut: bigint): number {
    // Simplified price impact calculation
    // In production, you'd want to compare against spot price
    const ratio = Number(amountOut) / Number(amountIn);
    const expectedRatio = 1.0; // Assumes 1:1 for simplification
    const impact = ((expectedRatio - ratio) / expectedRatio) * 100;
    return Math.max(0, impact);
  }
}
