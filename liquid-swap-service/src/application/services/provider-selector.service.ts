// Application Service - Provider Selection Orchestration
// Bridges the gap between domain routing logic and use cases
import { RouterDomainService } from "../../domain/services/router.domain.service";
import { SwapRequest, SwapQuote } from "../../domain/entities/swap";
import { SwapError } from "../../domain/entities/errors";
import { PreparedSwap } from "../../domain/ports/swap.provider.port";

const PROVIDER_ALIAS_PRIORITY: Record<string, string[]> = {
  uniswap: ["uniswap-trading-api"],
};

/**
 * QuoteWithProvider
 *
 * Quote result including which provider was selected
 */
export interface QuoteWithProvider {
  provider: string; // Provider name ('uniswap', 'thirdweb')
  quote: SwapQuote;
}

/**
 * PreparedSwapWithProvider
 *
 * Prepared swap result including which provider was used
 */
export interface PreparedSwapWithProvider {
  provider: string; // Provider name ('uniswap', 'thirdweb')
  prepared: PreparedSwap;
}

/**
 * ProviderSelectorService
 *
 * Application service that orchestrates provider selection for swap operations.
 * Acts as a facade over the RouterDomainService, converting between domain
 * types and application-level types.
 *
 * This service:
 * - Delegates routing logic to RouterDomainService
 * - Converts provider instances to string names for API responses
 * - Handles optional provider preferences from users
 *
 * @example
 * ```typescript
 * const selector = new ProviderSelectorService(router);
 *
 * // Auto-select best provider
 * const { provider, quote } = await selector.getQuoteWithBestProvider(request);
 * console.log('Using:', provider); // 'uniswap' or 'thirdweb'
 *
 * // Use specific provider
 * const prepared = await selector.prepareSwapWithProvider(request, 'uniswap');
 * ```
 */
export class ProviderSelectorService {
  constructor(private readonly router: RouterDomainService) {
    console.log("[ProviderSelectorService] Initialized");
  }

  /**
   * Get quote with automatic provider selection
   *
   * This method:
   * 1. Delegates to RouterDomainService for provider selection
   * 2. Converts provider instance to string name
   * 3. Returns quote with provider info
   *
   * @param request - Swap request
   * @returns Quote with provider name
   *
   * @example
   * ```typescript
   * const result = await selector.getQuoteWithBestProvider(swapRequest);
   * // result = { provider: 'uniswap', quote: SwapQuote }
   * ```
   */
  public async getQuoteWithBestProvider(
    request: SwapRequest
  ): Promise<QuoteWithProvider> {
    const { provider, quote } = await this.router.selectBestProvider(request);

    console.log(`[📋 SELECTOR] Quote finalizado — provider escolhido: "${provider.name}"`);

    return {
      provider: provider.name,
      quote,
    };
  }

  /**
   * Prepare swap with optional provider preference
   *
   * This method:
   * 1. If preferred provider specified: use it directly
   * 2. Otherwise: auto-select best provider
   * 3. Call prepareSwap on selected provider
   * 4. Return prepared transactions
   *
   * @param request - Swap request
   * @param preferredProvider - Optional provider name ('uniswap', 'thirdweb')
   * @returns Prepared swap with transactions
   *
   * @throws Error if preferred provider doesn't exist
   * @throws Error if preferred provider doesn't support route
   *
   * @example
   * ```typescript
   * // Auto-select
   * const prepared = await selector.prepareSwapWithProvider(request);
   *
   * // Force Uniswap
   * const prepared = await selector.prepareSwapWithProvider(request, 'uniswap');
   * ```
   */
  public async prepareSwapWithProvider(
    request: SwapRequest,
    preferredProvider?: string
  ): Promise<PreparedSwapWithProvider> {
    // Case 1: User specified a preferred provider
    if (preferredProvider) {
      console.log(
        `[ProviderSelectorService] Using preferred provider: ${preferredProvider}`
      );

      const providerCandidates = this.resolveProviderCandidates(preferredProvider);
      const supportErrors: string[] = [];

      for (const candidate of providerCandidates) {
        const provider = this.router.getProviderByName(candidate)!;
        if (candidate !== preferredProvider) {
          console.log(
            `[ProviderSelectorService] Resolved preferred provider '${preferredProvider}' → '${candidate}'`
          );
        }

        let supports = false;
        try {
          supports = await provider.supportsRoute({
            fromChainId: request.fromChainId,
            toChainId: request.toChainId,
            fromToken: request.fromToken,
            toToken: request.toToken,
          });
        } catch (error) {
          supportErrors.push(`${candidate}: ${(error as Error).message}`);
          continue;
        }

        if (!supports) {
          supportErrors.push(`${candidate}: route unsupported`);
          continue;
        }

        const prepared = await provider.prepareSwap(request);

        console.log(
          `[ProviderSelectorService] ✅ Prepared swap with ${candidate}`
        );

        return {
          provider: provider.name,
          prepared,
        };
      }

      const attempted = providerCandidates.join(", ");
      const detail = supportErrors.length
        ? ` Details: ${supportErrors.join(" | ")}`
        : "";
      throw new Error(
        `Provider '${preferredProvider}' does not support this swap route (${request.fromChainId} → ${request.toChainId}). Tried: ${attempted}.${detail ? ` ${detail}` : ""}`
      );
    }

    // Case 2: Auto-select best provider — delegates ranking to the policy
    const selected = await this.router.selectBestProviderWithoutQuote(request);
    const prepared = await selected.prepareSwap(request);
    return { provider: selected.name, prepared };
  }

  /**
   * Get available provider names
   *
   * Useful for API endpoints that want to list available options
   */
  public getAvailableProviders(): string[] {
    return this.router.getAvailableProviders();
  }

  /**
   * Check if a provider is available
   */
  public isProviderAvailable(name: string): boolean {
    try {
      this.resolveProviderCandidates(name);
      return true;
    } catch {
      return false;
    }
  }

  private resolveProviderCandidates(preferredProvider: string): string[] {
    const normalized = preferredProvider.trim().toLowerCase();
    const available = this.router.getAvailableProviders();

    const directMatch = available.find(
      (name) => name.toLowerCase() === normalized
    );
    if (directMatch) {
      return [directMatch];
    }

    const aliasTargets = PROVIDER_ALIAS_PRIORITY[normalized];
    if (aliasTargets && aliasTargets.length) {
      const resolved = aliasTargets.filter((target) =>
        available.some((name) => name.toLowerCase() === target.toLowerCase())
      );
      if (resolved.length) {
        return resolved;
      }
    }

    throw new Error(
      `Provider '${preferredProvider}' not available. Available providers: ${available.join(", ")}`
    );
  }
}
