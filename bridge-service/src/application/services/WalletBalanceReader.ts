import fs from 'fs';
import path from 'path';
import { Contract, JsonRpcProvider, formatUnits, getAddress } from 'ethers';

type TokenMetadata = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
};

type ChainRegistry = {
  name: string;
  explorer?: string;
  native: {
    symbol: string;
    name: string;
    decimals: number;
    icon?: string;
    identifiers?: Record<string, string>;
  };
  tokens: TokenMetadata[];
};

type RegistryData = {
  chains: Record<string, ChainRegistry>;
};

export interface WalletTokenBalance {
  chainId: number;
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balanceDisplay: string;
  isNative: boolean;
  isZero: boolean;
}

export interface BalanceChainSnapshot {
  chainId: number;
  chainName: string;
  nativeToken: {
    symbol: string;
    name: string;
    decimals: number;
  };
  nativeBalance: WalletTokenBalance;
  tokens: WalletTokenBalance[];
  fetchedAt: string;
  rpcSource: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface WalletBalancesResult {
  walletId: string;
  userId: string;
  walletAddress: string;
  chains: BalanceChainSnapshot[];
}

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

type TokenReadFailure = {
  tokenAddress: string;
  symbol: string;
  message: string;
};

function loadTokenRegistry(): RegistryData {
  const candidatePaths = [
    process.env.TOKEN_REGISTRY_PATH,
    path.resolve(process.cwd(), 'shared/token-registry.json'),
    path.resolve(process.cwd(), '../shared/token-registry.json'),
    path.resolve(process.cwd(), 'panorama-block-backend/shared/token-registry.json'),
    path.resolve(__dirname, '../../../../shared/token-registry.json'),
    path.resolve(__dirname, '../../../../../shared/token-registry.json'),
  ].filter((p): p is string => Boolean(p));

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RegistryData;
    }
  }

  throw new Error(`Token registry file not found. Checked paths: ${candidatePaths.join(', ')}`);
}

const tokenRegistry = loadTokenRegistry();

export function resolveWalletChainIds(walletChain: string, allowedChains?: number[]): number[] {
  if (Array.isArray(allowedChains) && allowedChains.length > 0) {
    return Array.from(new Set(allowedChains.map((value) => Number(value)).filter(Number.isFinite)));
  }

  switch (walletChain.trim().toLowerCase()) {
    case 'ethereum':
    case 'mainnet':
    case 'eth':
      return [1];
    case 'optimism':
      return [10];
    case 'bsc':
    case 'binance':
    case 'bnb':
    case 'bnb chain':
      return [56];
    case 'polygon':
      return [137];
    case 'arbitrum':
      return [42161];
    case 'base':
      return [8453];
    case 'ton':
      return [];
    default:
      return [];
  }
}

export function resolveEvmRpcUrl(chainId: number): string | undefined {
  switch (chainId) {
    case 1:
      return process.env.ETHEREUM_RPC_URL || process.env.RPC_URL || process.env.WDK_EVM_RPC_URL;
    case 10:
      return process.env.OPTIMISM_RPC_URL || process.env.WDK_EVM_RPC_URL;
    case 56:
      return process.env.BSC_RPC_URL || process.env.WDK_EVM_RPC_URL;
    case 137:
      return process.env.POLYGON_RPC_URL || process.env.WDK_EVM_RPC_URL;
    case 8453:
      return process.env.BASE_RPC_URL || process.env.WDK_EVM_RPC_URL;
    case 42161:
      return process.env.ARBITRUM_RPC_URL || process.env.WDK_EVM_RPC_URL;
    default:
      return process.env.RPC_URL || process.env.WDK_EVM_RPC_URL;
  }
}

function normalizeAddress(address: string): string {
  return getAddress(address.toLowerCase());
}

export class WalletBalanceReader {
  async readBalances(input: {
    walletId: string;
    userId: string;
    walletAddress: string;
    walletType: string;
    walletChain: string;
    allowedChains?: number[];
    chainIds?: number[];
    includeZeroBalances?: boolean;
  }): Promise<WalletBalancesResult> {
    if (input.walletType === 'ton' || input.walletChain.trim().toLowerCase() === 'ton') {
      const error = new Error('TON balance reads are not implemented yet') as Error & { status?: number; code?: string };
      error.status = 501;
      error.code = 'BALANCE_UNSUPPORTED_CHAIN_FAMILY';
      throw error;
    }

    const requestedChainIds = input.chainIds && input.chainIds.length > 0
      ? Array.from(new Set(input.chainIds))
      : resolveWalletChainIds(input.walletChain, input.allowedChains);

    if (requestedChainIds.length === 0) {
      const error = new Error('No supported EVM chains available for balance lookup') as Error & { status?: number; code?: string };
      error.status = 400;
      error.code = 'BALANCE_CHAIN_REQUIRED';
      throw error;
    }

    const walletAddress = normalizeAddress(input.walletAddress);
    const chains = await Promise.all(
      requestedChainIds.map(async (chainId) => await this.readChainBalances(chainId, walletAddress, input.includeZeroBalances === true))
    );

    if (!chains.some((chain) => !chain.error || chain.error.code === 'BALANCE_TOKEN_PARTIAL_FAILURE')) {
      const firstError = chains[0]?.error;
      const error = new Error(firstError?.message || 'All balance lookups failed') as Error & { status?: number; code?: string };
      error.status = 502;
      error.code = firstError?.code || 'BALANCE_LOOKUP_FAILED';
      throw error;
    }

    return {
      walletId: input.walletId,
      userId: input.userId,
      walletAddress,
      chains,
    };
  }

  private async readChainBalances(
    chainId: number,
    walletAddress: string,
    includeZeroBalances: boolean
  ): Promise<BalanceChainSnapshot> {
    const chain = tokenRegistry.chains[String(chainId)];
    const fetchedAt = new Date().toISOString();
    const rpcUrl = resolveEvmRpcUrl(chainId);

    if (!chain) {
      return {
        chainId,
        chainName: `Chain ${chainId}`,
        nativeToken: { symbol: 'UNKNOWN', name: 'Unknown', decimals: 18 },
        nativeBalance: {
          chainId,
          tokenAddress: 'native',
          symbol: 'UNKNOWN',
          name: 'Unknown',
          decimals: 18,
          balanceRaw: '0',
          balanceDisplay: '0',
          isNative: true,
          isZero: true,
        },
        tokens: [],
        fetchedAt,
        rpcSource: rpcUrl || 'unconfigured',
        error: {
          code: 'BALANCE_CHAIN_UNSUPPORTED',
          message: `Unsupported chain ${chainId}`,
        },
      };
    }

    if (!rpcUrl) {
      return {
        chainId,
        chainName: chain.name,
        nativeToken: { symbol: chain.native.symbol, name: chain.native.name, decimals: chain.native.decimals },
        nativeBalance: {
          chainId,
          tokenAddress: 'native',
          symbol: chain.native.symbol,
          name: chain.native.name,
          decimals: chain.native.decimals,
          balanceRaw: '0',
          balanceDisplay: '0',
          isNative: true,
          isZero: true,
        },
        tokens: [],
        fetchedAt,
        rpcSource: 'unconfigured',
        error: {
          code: 'BALANCE_RPC_UNCONFIGURED',
          message: `No RPC URL configured for chain ${chainId}`,
        },
      };
    }

    try {
      const provider = new JsonRpcProvider(rpcUrl);
      const nativeRaw = await provider.getBalance(walletAddress);
      const nativeBalance: WalletTokenBalance = {
        chainId,
        tokenAddress: 'native',
        symbol: chain.native.symbol,
        name: chain.native.name,
        decimals: chain.native.decimals,
        balanceRaw: nativeRaw.toString(),
        balanceDisplay: formatUnits(nativeRaw, chain.native.decimals),
        isNative: true,
        isZero: nativeRaw === 0n,
      };

      const tokenResults = await Promise.allSettled(
        (chain.tokens || []).map(async (token): Promise<WalletTokenBalance> => {
          const normalizedTokenAddress = normalizeAddress(token.address);
          const contract = new Contract(normalizedTokenAddress, ERC20_ABI, provider);
          const raw = BigInt(await contract.balanceOf(walletAddress));
          return {
            chainId,
            tokenAddress: normalizedTokenAddress,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            balanceRaw: raw.toString(),
            balanceDisplay: formatUnits(raw, token.decimals),
            isNative: false,
            isZero: raw === 0n,
          };
        })
      );

      const tokenBalances: WalletTokenBalance[] = [];
      const tokenFailures: TokenReadFailure[] = [];

      tokenResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          tokenBalances.push(result.value);
          return;
        }

        const token = chain.tokens?.[index];
        tokenFailures.push({
          tokenAddress: token?.address || `token-${index}`,
          symbol: token?.symbol || `token-${index}`,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      });

      const snapshot: BalanceChainSnapshot = {
        chainId,
        chainName: chain.name,
        nativeToken: { symbol: chain.native.symbol, name: chain.native.name, decimals: chain.native.decimals },
        nativeBalance,
        tokens: includeZeroBalances ? tokenBalances : tokenBalances.filter((token) => !token.isZero),
        fetchedAt,
        rpcSource: rpcUrl,
      };

      if (tokenFailures.length > 0) {
        snapshot.error = {
          code: 'BALANCE_TOKEN_PARTIAL_FAILURE',
          message: `Failed to read ${tokenFailures.length} token balance(s): ${tokenFailures
            .map((failure) => `${failure.symbol} (${failure.tokenAddress}): ${failure.message}`)
            .join('; ')}`,
        };
      }

      return snapshot;
    } catch (error) {
      return {
        chainId,
        chainName: chain.name,
        nativeToken: { symbol: chain.native.symbol, name: chain.native.name, decimals: chain.native.decimals },
        nativeBalance: {
          chainId,
          tokenAddress: 'native',
          symbol: chain.native.symbol,
          name: chain.native.name,
          decimals: chain.native.decimals,
          balanceRaw: '0',
          balanceDisplay: '0',
          isNative: true,
          isZero: true,
        },
        tokens: [],
        fetchedAt,
        rpcSource: rpcUrl,
        error: {
          code: 'BALANCE_LOOKUP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
