// Domain Service - Provider Routing Logic
// Responsible for selecting the best swap provider based on route characteristics
import { ISwapProvider, RouteParams } from "../ports/swap.provider.port";
import { SwapRequest, SwapQuote } from "../entities/swap";

/**
 * ProviderSelectionResult
 *
 * Result of provider selection with the chosen provider and obtained quote
 */
export interface ProviderSelectionResult {
  provider: ISwapProvider;
  quote: SwapQuote;
}

const BASE_CHAIN_ID = 8453;

/**
 * RouterDomainService
 *
 * Domain service that implements the business logic for selecting the best swap provider.
 *
 * Routing strategy:
 * - Base same-chain  → Execution Layer (Aerodrome) first, then Uniswap, then Thirdweb
 * - Other same-chain → Uniswap first, then Thirdweb
 * - Cross-chain      → Thirdweb (bridge specialist)
 */
export class RouterDomainService {
  private readonly smartRouterQuoteTimeoutMs: number;

  constructor(private readonly providers: Map<string, ISwapProvider>) {
    console.log(
      `[RouterDomainService] Initialized with ${providers.size} providers:`,
      Array.from(providers.keys())
    );

    const rawTimeout = process.env.SMART_ROUTER_QUOTE_TIMEOUT_MS;
    const parsedTimeout = rawTimeout ? Number(rawTimeout) : undefined;
    this.smartRouterQuoteTimeoutMs =
      parsedTimeout && parsedTimeout > 0 ? parsedTimeout : 10000;
  }

  /**
   * Select the best provider for a given swap request
   *
   * This method:
   * 1. Checks which providers support the route
   * 2. Applies priority logic (Uniswap for same-chain, Thirdweb for cross-chain)
   * 3. Gets quote from preferred provider
   * 4. Falls back to alternative providers if preferred one fails
   *
   * @param request - Swap request with all parameters
   * @returns Selected provider and quote
   * @throws Error if no provider supports the route or all providers fail
   */
  public async selectBestProvider(
    request: SwapRequest
  ): Promise<ProviderSelectionResult> {
    const isSameChain = this.isSameChain(request);
    const isBase = request.fromChainId === BASE_CHAIN_ID;
    const routeType = isSameChain
      ? isBase
        ? "same-chain BASE"
        : `same-chain (chain ${request.fromChainId})`
      : `cross-chain (${request.fromChainId} → ${request.toChainId})`;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[🔀 ROUTER] Nova requisição de quote`);
    console.log(`[🔀 ROUTER]   Par    : ${request.fromToken} → ${request.toToken}`);
    console.log(`[🔀 ROUTER]   Tipo   : ${routeType}`);
    console.log(`[🔀 ROUTER]   Amount : ${request.amount.toString()} wei`);
    console.log(`${"=".repeat(60)}`);

    const routeParams: RouteParams = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
    };

    const supportedProviders = await this.getSupportedProviders(routeParams);

    if (supportedProviders.length === 0) {
      console.error(`[🔀 ROUTER] ❌ Nenhum provider suporta esta rota`);
      throw new Error(
        `No swap provider supports route ${request.fromChainId} → ${request.toChainId}`
      );
    }

    console.log(
      `[🔀 ROUTER] Providers disponíveis: [${supportedProviders.map((p) => p.name).join(", ")}]`
    );

    if (isSameChain) {
      return await this.selectForSameChain(supportedProviders, request);
    } else {
      return await this.selectForCrossChain(supportedProviders, request);
    }
  }

  /**
   * Get all providers that support a given route
   *
   * Checks each provider in parallel for performance
   */
  private async getSupportedProviders(
    params: RouteParams
  ): Promise<ISwapProvider[]> {
    const checks = Array.from(this.providers.values()).map(async (provider) => {
      try {
        const supports = await provider.supportsRoute(params);
        return supports ? provider : null;
      } catch (error) {
        console.error(
          `[RouterDomainService] Error checking ${provider.name} support:`,
          (error as Error).message
        );
        return null;
      }
    });

    const results = await Promise.all(checks);
    return results.filter((p): p is ISwapProvider => p !== null);
  }

  /**
   * Select provider for same-chain swap.
   *
   * Priority para Base (chain 8453):
   *   1. Aerodrome via Execution Layer  (DEX nativo da Base, pools stable/volatile)
   *   2. Uniswap Trading API            (fallback — pares não listados no Aerodrome)
   *   3. Thirdweb                       (último recurso)
   *
   * Priority para outras chains same-chain:
   *   1. Uniswap Trading API
   *   2. Thirdweb
   */
  private async selectForSameChain(
    supportedProviders: ISwapProvider[],
    request: SwapRequest
  ): Promise<ProviderSelectionResult> {
    const isBase = request.fromChainId === BASE_CHAIN_ID;
    const errors: string[] = [];

    if (isBase) {
      console.log(`[🔀 ROUTER] ✅ Base same-chain → Prioridade: Execution Layer (Aerodrome) > Uniswap > Thirdweb`);

      // Priority 1 — Aerodrome via Execution Layer
      const aerodrome = supportedProviders.find((p) => p.name === "aerodrome");
      if (aerodrome) {
        console.log(`[🔀 ROUTER] 🚀 [P1] Tentando Execution Layer (Aerodrome) — rota nativa Base`);
        try {
          const quote = await aerodrome.getQuote(request);
          console.log(`[🔀 ROUTER] ✅ [P1] Execution Layer (Aerodrome) selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
          return { provider: aerodrome, quote };
        } catch (error) {
          console.warn(`[🔀 ROUTER] ⚠️ [P1] Execution Layer (Aerodrome) falhou: ${(error as Error).message}`);
          errors.push(`aerodrome: ${(error as Error).message}`);
        }
      } else {
        console.log(`[🔀 ROUTER] ℹ️ [P1] Aerodrome não suporta este par — tentando Uniswap`);
      }

      // Priority 2 — Uniswap Trading API (fallback para pares sem pool no Aerodrome)
      const uniswapTradingApi = supportedProviders.find(
        (p) => p.name === "uniswap-trading-api" || p.name === "uniswap"
      );
      if (uniswapTradingApi) {
        console.log(`[🔀 ROUTER] 🦄 [P2] Tentando Uniswap Trading API — fallback para par sem pool Aerodrome`);
        try {
          const quote = await uniswapTradingApi.getQuote(request);
          console.log(`[🔀 ROUTER] ✅ [P2] Uniswap Trading API selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
          return { provider: uniswapTradingApi, quote };
        } catch (error) {
          console.warn(`[🔀 ROUTER] ⚠️ [P2] Uniswap Trading API falhou: ${(error as Error).message}`);
          errors.push(`uniswap-trading-api: ${(error as Error).message}`);
        }
      }

      // Priority 3 — Thirdweb (último recurso)
      const thirdweb = supportedProviders.find((p) => p.name === "thirdweb");
      if (thirdweb) {
        console.log(`[🔀 ROUTER] 🌐 [P3] Tentando Thirdweb — último recurso para Base`);
        try {
          const quote = await thirdweb.getQuote(request);
          console.log(`[🔀 ROUTER] ✅ [P3] Thirdweb selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
          return { provider: thirdweb, quote };
        } catch (error) {
          console.warn(`[🔀 ROUTER] ⚠️ [P3] Thirdweb falhou: ${(error as Error).message}`);
          errors.push(`thirdweb: ${(error as Error).message}`);
        }
      }
    } else {
      console.log(`[🔀 ROUTER] ✅ Same-chain (chain ${request.fromChainId}) → Prioridade: Uniswap > Thirdweb`);

      // Priority 1 — Uniswap Trading API
      const uniswapTradingApi = supportedProviders.find(
        (p) => p.name === "uniswap-trading-api" || p.name === "uniswap"
      );
      if (uniswapTradingApi) {
        console.log(`[🔀 ROUTER] 🦄 [P1] Tentando Uniswap Trading API`);
        try {
          const quote = await uniswapTradingApi.getQuote(request);
          console.log(`[🔀 ROUTER] ✅ [P1] Uniswap Trading API selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
          return { provider: uniswapTradingApi, quote };
        } catch (error) {
          console.warn(`[🔀 ROUTER] ⚠️ [P1] Uniswap Trading API falhou: ${(error as Error).message}`);
          errors.push(`uniswap-trading-api: ${(error as Error).message}`);
        }
      }

      // Priority 2 — Thirdweb
      const thirdweb = supportedProviders.find((p) => p.name === "thirdweb");
      if (thirdweb) {
        console.log(`[🔀 ROUTER] 🌐 [P2] Tentando Thirdweb`);
        try {
          const quote = await thirdweb.getQuote(request);
          console.log(`[🔀 ROUTER] ✅ [P2] Thirdweb selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
          return { provider: thirdweb, quote };
        } catch (error) {
          console.warn(`[🔀 ROUTER] ⚠️ [P2] Thirdweb falhou: ${(error as Error).message}`);
          errors.push(`thirdweb: ${(error as Error).message}`);
        }
      }
    }

    const detail = errors.length ? `Motivos: ${errors.join("; ")}` : "Nenhum provider disponível";
    throw new Error(`Same-chain swap falhou em todos os providers. ${detail}`);
  }

  /**
   * Select provider for cross-chain swap.
   * Priority: Thirdweb (especialista em bridges)
   */
  private async selectForCrossChain(
    supportedProviders: ISwapProvider[],
    request: SwapRequest
  ): Promise<ProviderSelectionResult> {
    console.log(`[🔀 ROUTER] 🌉 Cross-chain (${request.fromChainId} → ${request.toChainId}) → Prioridade: Thirdweb`);

    const thirdweb = supportedProviders.find((p) => p.name === "thirdweb");
    if (thirdweb) {
      console.log(`[🔀 ROUTER] 🌐 [P1] Tentando Thirdweb — bridge cross-chain`);
      try {
        const quote = await thirdweb.getQuote(request);
        console.log(`[🔀 ROUTER] ✅ [P1] Thirdweb selecionado — amountOut: ${quote.estimatedReceiveAmount.toString()}`);
        return { provider: thirdweb, quote };
      } catch (error) {
        console.warn(`[🔀 ROUTER] ⚠️ [P1] Thirdweb falhou: ${(error as Error).message}`);
      }
    }

    console.log(`[🔀 ROUTER] ⚠️ Thirdweb indisponível — tentando outros providers como fallback`);
    return await this.tryFallbackProviders(supportedProviders, request, ["thirdweb"]);
  }

  /**
   * Try remaining providers as fallback
   *
   * @param supportedProviders - All providers that support the route
   * @param request - Swap request
   * @param excludeNames - Provider names to exclude (already tried)
   */
  private async tryFallbackProviders(
    supportedProviders: ISwapProvider[],
    request: SwapRequest,
    excludeNames: string[]
  ): Promise<ProviderSelectionResult> {
    const fallbackProviders = supportedProviders.filter(
      (p) => !excludeNames.includes(p.name)
    );

    if (fallbackProviders.length === 0) {
      console.error(
        "[RouterDomainService] ❌ No fallback providers available"
      );
      throw new Error(
        "All preferred providers failed and no fallback available"
      );
    }

    console.log(
      "[RouterDomainService] ⚠️ Trying fallback providers:",
      fallbackProviders.map((p) => p.name)
    );

    // Try each fallback provider in order
    const errors: Error[] = [];

    for (const provider of fallbackProviders) {
      try {
        console.log(
          `[RouterDomainService] Attempting fallback: ${provider.name}`
        );
        const quote = await provider.getQuote(request);
        console.log(
          `[RouterDomainService] ✅ Fallback ${provider.name} successful`
        );
        return { provider, quote };
      } catch (error) {
        console.warn(
          `[RouterDomainService] Fallback ${provider.name} failed:`,
          (error as Error).message
        );
        errors.push(error as Error);
      }
    }

    // All providers failed
    console.error(
      "[RouterDomainService] ❌ All providers failed:",
      errors.map((e) => e.message)
    );
    throw new Error(
      `All swap providers failed. Errors: ${errors.map((e) => e.message).join("; ")}`
    );
  }

  /**
   * Check if swap is same-chain
   */
  private isSameChain(request: SwapRequest): boolean {
    return request.fromChainId === request.toChainId;
  }

  private async getQuoteWithTimeout(
    provider: ISwapProvider,
    request: SwapRequest,
    timeoutMs: number
  ): Promise<SwapQuote> {
    if (!timeoutMs || timeoutMs <= 0) {
      return provider.getQuote(request);
    }

    return new Promise<SwapQuote>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`${provider.name} quote timed out after ${timeoutMs}ms`)
        );
      }, timeoutMs);

      provider
        .getQuote(request)
        .then((quote) => {
          clearTimeout(timer);
          resolve(quote);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Select best provider WITHOUT getting a quote
   *
   * This is used during prepareSwap to avoid calling getQuote() twice,
   * which would invalidate the quote cache.
   *
   * @param request - Swap request
   * @returns Selected provider (without quote)
   */
  public async selectBestProviderWithoutQuote(
    request: SwapRequest
  ): Promise<ISwapProvider> {
    const isSameChain = this.isSameChain(request);
    const isBase = request.fromChainId === BASE_CHAIN_ID;

    const routeParams: RouteParams = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
    };

    const supportedProviders = await this.getSupportedProviders(routeParams);

    if (supportedProviders.length === 0) {
      throw new Error(
        `No swap provider supports route ${request.fromChainId} → ${request.toChainId}`
      );
    }

    if (isSameChain && isBase) {
      const aerodrome = supportedProviders.find((p) => p.name === "aerodrome");
      if (aerodrome) {
        console.log(`[🔀 ROUTER] [PREPARE] P1 → Execution Layer (Aerodrome) — Base same-chain`);
        return aerodrome;
      }
      const uniswap = supportedProviders.find(
        (p) => p.name === "uniswap-trading-api" || p.name === "uniswap"
      );
      if (uniswap) {
        console.log(`[🔀 ROUTER] [PREPARE] P2 → Uniswap Trading API — par sem pool Aerodrome`);
        return uniswap;
      }
    } else if (isSameChain) {
      const uniswap = supportedProviders.find(
        (p) => p.name === "uniswap-trading-api" || p.name === "uniswap"
      );
      if (uniswap) {
        console.log(`[🔀 ROUTER] [PREPARE] P1 → Uniswap Trading API — same-chain (chain ${request.fromChainId})`);
        return uniswap;
      }
    } else {
      const thirdweb = supportedProviders.find((p) => p.name === "thirdweb");
      if (thirdweb) {
        console.log(`[🔀 ROUTER] [PREPARE] P1 → Thirdweb — cross-chain`);
        return thirdweb;
      }
    }

    const thirdweb = supportedProviders.find((p) => p.name === "thirdweb");
    if (thirdweb) {
      console.log(`[🔀 ROUTER] [PREPARE] Fallback → Thirdweb`);
      return thirdweb;
    }

    console.log(`[🔀 ROUTER] [PREPARE] Fallback → ${supportedProviders[0].name}`);
    return supportedProviders[0];
  }

  /**
   * Get a specific provider by name
   *
   * Useful for when user explicitly requests a provider
   */
  public getProviderByName(name: string): ISwapProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if a provider exists
   */
  public hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all available provider names
   */
  public getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
