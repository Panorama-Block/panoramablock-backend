import { ChainAssetPriorityPolicy, fallbackInvoke } from '../../../shared/capability/policy';
import { CapabilityError } from '../../../shared/capability/errors';
import type { IBridgeProvider, BridgeRouteRequest, BridgeLimits, BridgeQuoteRequest, BridgeQuoteResult, BridgeTransactionRequest, BridgeTransactionResult, BridgeSwapStatus } from '../domain/ports/bridge.provider.port';

// TON pseudo chain-id used in PolicyContext
const TON_CHAIN_ID = 607;

// EVM chain IDs that Layerswap supports as destination
const EVM_CHAIN_IDS: Record<string, number> = {
  ETHEREUM_MAINNET: 1,
  BASE_MAINNET: 8453,
  ARBITRUM_MAINNET: 42161,
  AVALANCHE_MAINNET: 43114,
};

const BRIDGE_POLICY = new ChainAssetPriorityPolicy({
  // Any cross-chain request (TON→EVM or EVM→EVM) routes to Layerswap
  'default-cross-chain': ['layerswap'],
  // Fallback for same-chain (shouldn't happen in bridge, but guard it)
  default: ['layerswap'],
});

function chainIdOf(network: string): number {
  if (network === 'TON_MAINNET') return TON_CHAIN_ID;
  return EVM_CHAIN_IDS[network] ?? 0;
}

export class BridgeCapabilityService {
  private readonly providers: readonly IBridgeProvider[];

  constructor(providers: IBridgeProvider[]) {
    this.providers = providers;
  }

  async getLimits(req: BridgeRouteRequest): Promise<BridgeLimits> {
    const ranked = BRIDGE_POLICY.rank(this.providers, {
      chainId: chainIdOf(req.sourceNetwork),
      destinationChainId: chainIdOf(req.destinationNetwork),
    });

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute(req.sourceNetwork, req.destinationNetwork),
      invoke: (p) => p.getLimits(req),
      capability: 'bridge',
    });

    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  async getQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult> {
    const ranked = BRIDGE_POLICY.rank(this.providers, {
      chainId: chainIdOf(req.sourceNetwork),
      destinationChainId: chainIdOf(req.destinationNetwork),
      asset: req.sourceToken,
    });

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute(req.sourceNetwork, req.destinationNetwork),
      invoke: (p) => p.getQuote(req),
      capability: 'bridge',
      shouldFallback: (err) => {
        if (CapabilityError.is(err)) {
          // Liquidity errors are provider-specific — try next
          return 'fallback';
        }
        return 'fallback';
      },
    });

    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  async createTransaction(req: BridgeTransactionRequest): Promise<BridgeTransactionResult> {
    const ranked = BRIDGE_POLICY.rank(this.providers, {
      chainId: chainIdOf(req.sourceNetwork),
      destinationChainId: chainIdOf(req.destinationNetwork),
      asset: req.sourceToken,
    });

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute(req.sourceNetwork, req.destinationNetwork),
      invoke: (p) => p.createTransaction(req),
      capability: 'bridge',
    });

    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  async getStatus(swapId: string): Promise<BridgeSwapStatus> {
    // Status polling doesn't need routing — we know which provider created the swap
    // Try all providers; in practice only layerswap exists
    for (const provider of this.providers) {
      try {
        return await provider.getStatus(swapId);
      } catch (e) {
        if (CapabilityError.is(e) && this.providers.indexOf(provider) < this.providers.length - 1) {
          continue;
        }
        throw e;
      }
    }
    throw CapabilityError.unavailable('No bridge provider available to fetch swap status');
  }
}
