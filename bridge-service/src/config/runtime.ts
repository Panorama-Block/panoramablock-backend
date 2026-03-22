export interface BridgeRuntimeConfig {
  tokenRegistryPath?: string;
  swapSubmissionReconciliationMs: number;
  defaultEvmRpcUrl?: string;
  chainRpcUrls: Partial<Record<number, string>>;
}

export function createBridgeRuntimeConfig(input: {
  tokenRegistryPath?: string;
  swapSubmissionReconciliationMs?: number;
  defaultEvmRpcUrl?: string;
  chainRpcUrls?: Partial<Record<number, string | undefined>>;
} = {}): BridgeRuntimeConfig {
  const chainRpcUrls = Object.entries(input.chainRpcUrls || {}).reduce<Partial<Record<number, string>>>((acc, [chainId, rpcUrl]) => {
    if (typeof rpcUrl === 'string' && rpcUrl.trim().length > 0) {
      acc[Number(chainId)] = rpcUrl.trim();
    }
    return acc;
  }, {});

  return {
    tokenRegistryPath: normalizeOptionalString(input.tokenRegistryPath),
    swapSubmissionReconciliationMs:
      typeof input.swapSubmissionReconciliationMs === 'number' &&
      Number.isFinite(input.swapSubmissionReconciliationMs) &&
      input.swapSubmissionReconciliationMs > 0
        ? input.swapSubmissionReconciliationMs
        : 120000,
    defaultEvmRpcUrl: normalizeOptionalString(input.defaultEvmRpcUrl),
    chainRpcUrls,
  };
}

export function createBridgeRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeRuntimeConfig {
  return createBridgeRuntimeConfig({
    tokenRegistryPath: env.TOKEN_REGISTRY_PATH,
    swapSubmissionReconciliationMs: Number(env.PANORAMA_SWAP_SUBMISSION_RECONCILIATION_MS || 120000),
    defaultEvmRpcUrl: env.RPC_URL || env.WDK_EVM_RPC_URL,
    chainRpcUrls: {
      1: env.ETHEREUM_RPC_URL || env.RPC_URL || env.WDK_EVM_RPC_URL,
      10: env.OPTIMISM_RPC_URL || env.WDK_EVM_RPC_URL,
      56: env.BSC_RPC_URL || env.WDK_EVM_RPC_URL,
      137: env.POLYGON_RPC_URL || env.WDK_EVM_RPC_URL,
      8453: env.BASE_RPC_URL || env.WDK_EVM_RPC_URL,
      42161: env.ARBITRUM_RPC_URL || env.WDK_EVM_RPC_URL,
    },
  });
}

export function resolveRpcUrl(chainId: number, config: BridgeRuntimeConfig): string | undefined {
  return config.chainRpcUrls[chainId] || config.defaultEvmRpcUrl;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
