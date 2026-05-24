/**
 * Multi-Hop Swap Adapter
 *
 * Implements 2-step swaps for cross-chain routes with unsupported tokens:
 *
 * Example: UNI (Base) → ETH (Arbitrum)
 * Step 1: UNI → ETH (same-chain on Base via Uniswap)
 * Step 2: ETH → ETH (cross-chain Base → Arbitrum via Thirdweb)
 *
 * This adapter wraps existing providers and chains their operations.
 */

import type { ProviderMetadata } from '@panorama/capability';
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from '../../domain/ports/swap.provider.port';
import { SwapRequest, SwapQuote } from '../../domain/entities/swap';
import { SwapError, SwapErrorCode } from '../../domain/entities/errors';

// Extended RouteParams with sender for internal multi-hop routing
interface RouteParamsWithSender extends RouteParams {
  sender: string;
}

interface MultiHopRoute {
  step1: {
    provider: ISwapProvider;
    request: SwapRequest;
  };
  step2: {
    provider: ISwapProvider;
    request: SwapRequest;
  };
  bridgeToken: {
    address: string;
    symbol: string;
    chainId: number;
  };
}

export class MultiHopSwapAdapter implements ISwapProvider {
  public readonly name = 'multihop';
  public readonly metadata: ProviderMetadata = {
    name: 'multihop',
    capability: 'swap',
    // Composite of same-chain (Uniswap) + cross-chain (Thirdweb). Conservative union of their
    // supported chains; actual reachability is resolved dynamically in supportsRoute().
    supportedChains: [1, 10, 137, 8453, 42161, 43114, 56],
    features: ['cross-chain', 'multi-hop', 'bridge-token-pivot'],
    version: '1.0.0',
    enabled: true,
  };

  constructor(
    private readonly sameChainProvider: ISwapProvider, // Uniswap Trading API
    private readonly crossChainProvider: ISwapProvider, // Thirdweb Bridge
  ) {
    console.log('[MultiHopSwapAdapter] Initialized with 2-step routing capability');
  }

  /**
   * Check if this adapter can handle the route via multi-hop
   *
   * Criteria:
   * 1. Cross-chain swap (fromChainId !== toChainId)
   * 2. At least one token is not natively supported for cross-chain
   * 3. We can bridge via an intermediate token (ETH, USDC, WETH)
   */
  async supportsRoute(params: RouteParams): Promise<boolean> {
    // Only for cross-chain
    if (params.fromChainId === params.toChainId) {
      return false;
    }

    // Check if direct cross-chain is already supported
    const directSupported = await this.crossChainProvider.supportsRoute(params);
    if (directSupported) {
      // Direct route available, no need for multi-hop
      return false;
    }

    // Check if we can build a multi-hop route
    // Note: buildMultiHopRoute needs a sender, but supportsRoute doesn't have it
    // For now, use a placeholder address for route checking
    try {
      await this.buildMultiHopRoute({ ...params, sender: '0x0000000000000000000000000000000000000000' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get quote for multi-hop swap
   *
   * This aggregates quotes from both steps:
   * - Step 1: Origin token → Bridge token (same-chain)
   * - Step 2: Bridge token → Destination token (cross-chain or same-chain)
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    console.log('[MultiHopSwapAdapter] Getting multi-hop quote for:', request.toLogString());

    const route = await this.buildMultiHopRoute({
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
      sender: request.sender,
    });

    console.log('[MultiHopSwapAdapter] Multi-hop route:', {
      step1: `${request.fromToken} → ${route.bridgeToken.symbol} on chain ${request.fromChainId}`,
      step2: `${route.bridgeToken.symbol} → ${request.toToken} on chain ${request.toChainId}`,
    });

    // Get quote for step 1 (origin → bridge token)
    const quote1 = await route.step1.provider.getQuote(route.step1.request);
    console.log('[MultiHopSwapAdapter] Step 1 quote:', {
      provider: route.step1.provider.name,
      output: quote1.estimatedReceiveAmount.toString(),
    });

    // Use step 1 output as step 2 input
    const step2Request = new SwapRequest(
      route.step2.request.fromChainId,
      route.step2.request.toChainId,
      route.step2.request.fromToken,
      route.step2.request.toToken,
      quote1.estimatedReceiveAmount, // Output from step 1
      route.step2.request.sender,
      route.step2.request.receiver,
    );

    // Get quote for step 2 (bridge token → destination)
    const quote2 = await route.step2.provider.getQuote(step2Request);
    console.log('[MultiHopSwapAdapter] Step 2 quote:', {
      provider: route.step2.provider.name,
      output: quote2.estimatedReceiveAmount.toString(),
    });

    // Aggregate quotes
    const totalFee = quote1.bridgeFee + quote1.gasFee + quote2.bridgeFee + quote2.gasFee;
    const totalDuration = quote1.estimatedDuration + quote2.estimatedDuration;

    // Calculate overall exchange rate: output / input
    const inputAmount = request.amount;
    const outputAmount = quote2.estimatedReceiveAmount;

    // Simple rate calculation (can be improved with decimals awareness)
    const rate = inputAmount === 0n
      ? 0
      : Number(outputAmount * 10000n / inputAmount) / 10000;

    return new SwapQuote(
      outputAmount,
      quote1.bridgeFee + quote2.bridgeFee,
      quote1.gasFee + quote2.gasFee,
      rate,
      totalDuration,
    );
  }

  /**
   * Prepare multi-hop swap transactions
   *
   * Returns a bundle of transactions:
   * 1. [Optional] Approve origin token (if ERC-20)
   * 2. Swap origin → bridge token (same-chain)
   * 3. [Optional] Approve bridge token (if needed)
   * 4. Bridge/swap bridge token → destination (cross-chain)
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    console.log('[MultiHopSwapAdapter] Preparing multi-hop swap for:', request.toLogString());

    const route = await this.buildMultiHopRoute({
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
      sender: request.sender,
    });

    // Prepare step 1
    const prepared1 = await route.step1.provider.prepareSwap(route.step1.request);
    console.log('[MultiHopSwapAdapter] Step 1 prepared:', {
      provider: route.step1.provider.name,
      txCount: prepared1.transactions.length,
    });

    // Get step 1 output amount for step 2 input
    const quote1 = await route.step1.provider.getQuote(route.step1.request);

    const step2Request = new SwapRequest(
      route.step2.request.fromChainId,
      route.step2.request.toChainId,
      route.step2.request.fromToken,
      route.step2.request.toToken,
      quote1.estimatedReceiveAmount,
      route.step2.request.sender,
      route.step2.request.receiver,
    );

    // Prepare step 2
    const prepared2 = await route.step2.provider.prepareSwap(step2Request);
    console.log('[MultiHopSwapAdapter] Step 2 prepared:', {
      provider: route.step2.provider.name,
      txCount: prepared2.transactions.length,
    });

    // Combine transactions
    const allTransactions: Transaction[] = [
      ...prepared1.transactions,
      ...prepared2.transactions,
    ];

    console.log('[MultiHopSwapAdapter] ✅ Multi-hop swap prepared:', {
      totalSteps: 2,
      totalTxs: allTransactions.length,
      step1Provider: route.step1.provider.name,
      step2Provider: route.step2.provider.name,
    });

    return {
      provider: this.name,
      transactions: allTransactions,
      estimatedDuration: prepared1.estimatedDuration + prepared2.estimatedDuration,
    };
  }

  /**
   * Monitor transaction status
   *
   * For multi-hop, we need to check all transactions in the sequence
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<import('../../domain/entities/swap').TransactionStatus> {
    // Delegate to the appropriate provider based on chainId
    // This is a simplified implementation
    console.log(`[MultiHopSwapAdapter] Monitoring transaction ${txHash} on chain ${chainId}`);

    // Try same-chain provider first
    try {
      return await this.sameChainProvider.monitorTransaction(txHash, chainId);
    } catch {
      // Fallback to cross-chain provider
      return await this.crossChainProvider.monitorTransaction(txHash, chainId);
    }
  }

  /**
   * Build a multi-hop route for unsupported cross-chain swaps
   *
   * Strategy:
   * 1. Find a bridge token that both chains support (ETH, USDC, WETH)
   * 2. Step 1: Swap origin token → bridge token (same-chain via Uniswap)
   * 3. Step 2: Bridge token → destination token (cross-chain via Thirdweb or same-chain via Uniswap)
   */
  private async buildMultiHopRoute(params: RouteParamsWithSender): Promise<MultiHopRoute> {
    // Common bridge tokens (in order of preference)
    const bridgeTokenCandidates = [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'WETH', address: 'WETH' }, // Will be resolved per chain
      { symbol: 'USDC', address: 'USDC' },
      { symbol: 'USDT', address: 'USDT' },
    ];

    for (const candidate of bridgeTokenCandidates) {
      try {
        // Step 1: Origin token → Bridge token (same-chain on origin)
        const step1Supported = await this.sameChainProvider.supportsRoute({
          fromChainId: params.fromChainId,
          toChainId: params.fromChainId, // Same chain
          fromToken: params.fromToken,
          toToken: candidate.symbol.toLowerCase(), // Use symbol for now
        });

        if (!step1Supported) {
          continue;
        }

        // Step 2: Bridge token → Destination token
        // This can be either:
        // - Cross-chain (bridge token on origin → bridge token on destination)
        // - Same-chain (bridge token → dest token on destination chain)

        let step2Supported = false;
        let step2Request: SwapRequest;

        // Try cross-chain bridge first (bridge token origin → bridge token destination)
        if (params.fromChainId !== params.toChainId) {
          step2Supported = await this.crossChainProvider.supportsRoute({
            fromChainId: params.fromChainId,
            toChainId: params.toChainId,
            fromToken: candidate.symbol.toLowerCase(),
            toToken: params.toToken,
          });

          if (step2Supported) {
            step2Request = new SwapRequest(
              params.fromChainId,
              params.toChainId,
              candidate.symbol.toLowerCase(),
              params.toToken,
              0n, // Will be filled from step 1 output
              params.sender,
              params.sender,
            );
          }
        }

        // If cross-chain didn't work, try same-chain on destination
        if (!step2Supported && params.fromChainId !== params.toChainId) {
          // First bridge the bridge token cross-chain
          const bridgeSupported = await this.crossChainProvider.supportsRoute({
            fromChainId: params.fromChainId,
            toChainId: params.toChainId,
            fromToken: candidate.symbol.toLowerCase(),
            toToken: candidate.symbol.toLowerCase(),
          });

          if (bridgeSupported) {
            // Then swap on destination chain
            const destSwapSupported = await this.sameChainProvider.supportsRoute({
              fromChainId: params.toChainId,
              toChainId: params.toChainId,
              fromToken: candidate.symbol.toLowerCase(),
              toToken: params.toToken,
            });

            if (destSwapSupported) {
              step2Supported = true;
              step2Request = new SwapRequest(
                params.fromChainId,
                params.toChainId,
                candidate.symbol.toLowerCase(),
                candidate.symbol.toLowerCase(),
                0n,
                params.sender,
                params.sender,
              );
              // Note: This would require 3 steps total, which is more complex
              // For now, we'll skip this scenario
              continue;
            }
          }
        }

        if (step2Supported) {
          return {
            step1: {
              provider: this.sameChainProvider,
              request: new SwapRequest(
                params.fromChainId,
                params.fromChainId,
                params.fromToken,
                candidate.symbol.toLowerCase(),
                0n, // Will be filled from user input
                params.sender,
                params.sender,
              ),
            },
            step2: {
              provider: this.crossChainProvider,
              request: step2Request!,
            },
            bridgeToken: {
              address: candidate.address,
              symbol: candidate.symbol,
              chainId: params.fromChainId,
            },
          };
        }
      } catch (error) {
        console.warn(`[MultiHopSwapAdapter] Failed to build route via ${candidate.symbol}:`, error);
        continue;
      }
    }

    throw new SwapError(
      SwapErrorCode.NO_ROUTE_FOUND,
      `No multi-hop route found for ${params.fromToken} (${params.fromChainId}) → ${params.toToken} (${params.toChainId}). ` +
      `Tried bridge tokens: ${bridgeTokenCandidates.map(t => t.symbol).join(', ')}`,
      { fromChainId: params.fromChainId, toChainId: params.toChainId }
    );
  }
}
