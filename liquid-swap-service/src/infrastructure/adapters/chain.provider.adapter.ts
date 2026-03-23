import { IChainProvider } from "../../domain/ports/swap.repository";
import { ethers } from "ethers";

/**
 * Parse comma-separated RPC URLs from env var, falling back to single URL.
 * Example: BASE_RPC_URLS="https://mainnet.base.org,https://base.llamarpc.com"
 */
function parseRpcUrls(listEnv: string | undefined, singleUrl: string): string[] {
  if (listEnv) {
    const urls = listEnv.split(",").map(u => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return [singleUrl];
}

export class ChainProviderAdapter implements IChainProvider {
  private readonly supportedChains = [1, 137, 56, 8453, 10, 42161, 43114];
  private readonly providers: { [chainId: number]: ethers.providers.BaseProvider } = {};

  constructor() {
    this.initializeProviders();
    console.log("[ChainProviderAdapter] Initialized for chains:", this.supportedChains);
  }

  private initializeProviders(): void {
    for (const chainId of this.supportedChains) {
      const rpcUrls = this.getRpcUrls(chainId);
      const network = { name: `chain-${chainId}`, chainId };

      if (rpcUrls.length === 1) {
        this.providers[chainId] = new ethers.providers.StaticJsonRpcProvider(
          { url: rpcUrls[0], skipFetchSetup: true },
          network
        );
      } else {
        // Multiple RPCs: FallbackProvider tries them in priority order
        const rpcProviders = rpcUrls.map((url, index) => ({
          provider: new ethers.providers.StaticJsonRpcProvider(
            { url, skipFetchSetup: true },
            network
          ),
          priority: index + 1,   // lower = preferred
          stallTimeout: 2000,
          weight: 1,
        }));

        this.providers[chainId] = new ethers.providers.FallbackProvider(rpcProviders, chainId);
        console.log(`[ChainProviderAdapter] Chain ${chainId}: ${rpcUrls.length} RPC endpoints (fallback enabled)`);
      }
    }
  }

  public getProvider(chainId: number): any {
    if (!this.isChainSupported(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }
    return this.providers[chainId];
  }

  public getSigner(_chainId: number): never {
    throw new Error("Signer access is disabled in non-custodial mode");
  }

  public getRpcUrl(chainId: number): string {
    return this.getRpcUrls(chainId)[0];
  }

  private getRpcUrls(chainId: number): string[] {
    const chainRpcConfig: { [key: number]: { listEnv: string | undefined; defaultUrl: string } } = {
      1:     { listEnv: process.env.ETHEREUM_RPC_URLS,  defaultUrl: process.env.ETHEREUM_RPC_URL  || "https://eth.llamarpc.com" },
      137:   { listEnv: process.env.POLYGON_RPC_URLS,   defaultUrl: process.env.POLYGON_RPC_URL   || "https://polygon.llamarpc.com" },
      56:    { listEnv: process.env.BSC_RPC_URLS,       defaultUrl: process.env.BSC_RPC_URL       || "https://bsc.llamarpc.com" },
      8453:  { listEnv: process.env.BASE_RPC_URLS,      defaultUrl: process.env.BASE_RPC_URL      || "https://base.llamarpc.com" },
      10:    { listEnv: process.env.OPTIMISM_RPC_URLS,  defaultUrl: process.env.OPTIMISM_RPC_URL  || "https://optimism.llamarpc.com" },
      42161: { listEnv: process.env.ARBITRUM_RPC_URLS,  defaultUrl: process.env.ARBITRUM_RPC_URL  || "https://arbitrum.llamarpc.com" },
      43114: { listEnv: process.env.AVALANCHE_RPC_URLS, defaultUrl: process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc" },
    };

    const config = chainRpcConfig[chainId];
    if (!config) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }

    return parseRpcUrls(config.listEnv, config.defaultUrl);
  }

  public isChainSupported(chainId: number): boolean {
    return this.supportedChains.includes(chainId);
  }
}
