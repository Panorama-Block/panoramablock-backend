/**
 * Uniswap Smart Order Router Adapter — DISABLED
 *
 * The smart-order-router integration was intentionally disabled to avoid the
 * dependency and build overhead in CI. Keep this adapter as a no-op so the
 * provider selection logic can continue to fall through to the remaining
 * providers without special-case branching.
 */

import { SwapQuote, SwapRequest, TransactionStatus } from '../../domain/entities/swap';
import { ISwapProvider, PreparedSwap, RouteParams } from '../../domain/ports/swap.provider.port';

export class UniswapSmartRouterAdapter implements ISwapProvider {
  public readonly name = 'uniswap-smart-router';

  constructor() {
    console.log(`[${this.name}] Smart Order Router disabled; falling back to other providers`);
  }

  async supportsRoute(_params: RouteParams): Promise<boolean> {
    return false;
  }

  async getQuote(_request: SwapRequest): Promise<SwapQuote> {
    throw new Error(`[${this.name}] Provider disabled`);
  }

  async prepareSwap(_request: SwapRequest): Promise<PreparedSwap> {
    throw new Error(`[${this.name}] Provider disabled`);
  }

  async monitorTransaction(_txHash: string, _chainId: number): Promise<TransactionStatus> {
    return TransactionStatus.FAILED;
  }
}
