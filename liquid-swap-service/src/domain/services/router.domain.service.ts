// Domain Service - Provider Routing Logic
// Uses ChainAssetPriorityPolicy to rank providers per chain instead of hardcoded names.
import {
  ProviderRegistry,
  ChainAssetPriorityPolicy,
  fallbackInvoke,
  type IPriorityPolicy,
  type PolicyContext,
} from "@panorama/capability";
import { ISwapProvider, RouteParams } from "../ports/swap.provider.port";
import { SwapRequest, SwapQuote } from "../entities/swap";

export interface ProviderSelectionResult {
  provider: ISwapProvider;
  quote: SwapQuote;
}

export class RouterDomainService {
  constructor(
    private readonly registry: ProviderRegistry<ISwapProvider>,
    private readonly policy: IPriorityPolicy = new ChainAssetPriorityPolicy({
      "8453": ["aerodrome", "uniswap-trading-api", "uniswap", "thirdweb"],
      "1": ["uniswap-trading-api", "uniswap", "thirdweb"],
      "42161": ["uniswap-trading-api", "uniswap", "thirdweb"],
      "10": ["uniswap-trading-api", "uniswap", "thirdweb"],
      "137": ["uniswap-trading-api", "uniswap", "thirdweb"],
      "43114": ["traderjoe", "uniswap-trading-api", "uniswap", "thirdweb"],
      "default-cross-chain": ["thirdweb", "uniswap-trading-api", "uniswap"],
    })
  ) {
    console.log(
      `[RouterDomainService] Initialized with ${registry.size()} providers:`,
      registry.listAll({ includeDisabled: true }).map((p) => p.name)
    );
  }

  public async selectBestProvider(
    request: SwapRequest
  ): Promise<ProviderSelectionResult> {
    const routeParams: RouteParams = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
    };

    const supported = await this.getSupportedProviders(routeParams);
    if (supported.length === 0) {
      throw new Error(
        `No swap provider supports route ${request.fromChainId} → ${request.toChainId}`
      );
    }

    const isCrossChain = request.fromChainId !== request.toChainId;
    const ctx: PolicyContext = {
      chainId: request.fromChainId,
      ...(isCrossChain && { destinationChainId: request.toChainId }),
    };
    const ranked = this.policy.rank(supported, ctx);

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute(routeParams),
      invoke: async (p) => {
        const quote = await p.getQuote(request);
        return { provider: p, quote } as ProviderSelectionResult;
      },
      capability: "swap",
    });

    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  public async selectBestProviderWithoutQuote(
    request: SwapRequest
  ): Promise<ISwapProvider> {
    const routeParams: RouteParams = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
    };

    const supported = await this.getSupportedProviders(routeParams);
    if (supported.length === 0) {
      throw new Error(
        `No swap provider supports route ${request.fromChainId} → ${request.toChainId}`
      );
    }

    const isCrossChain = request.fromChainId !== request.toChainId;
    const ctx: PolicyContext = {
      chainId: request.fromChainId,
      ...(isCrossChain && { destinationChainId: request.toChainId }),
    };
    return this.policy.rank(supported, ctx)[0]!;
  }

  private async getSupportedProviders(
    params: RouteParams
  ): Promise<ISwapProvider[]> {
    const all = this.registry.listAll({ includeDisabled: true });
    const checks = all.map(async (provider) => {
      try {
        return (await provider.supportsRoute(params)) ? provider : null;
      } catch {
        return null;
      }
    });
    const results = await Promise.all(checks);
    return results.filter((p): p is ISwapProvider => p !== null);
  }

  public getProviderByName(name: string): ISwapProvider | undefined {
    return this.registry.getByName(name);
  }

  public hasProvider(name: string): boolean {
    return this.registry.getByName(name) !== undefined;
  }

  public getAvailableProviders(): string[] {
    return this.registry
      .listAll({ includeDisabled: true })
      .map((p) => p.name);
  }
}
