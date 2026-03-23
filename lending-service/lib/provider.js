const { ethers } = require('ethers');
const { NETWORKS } = require('../config/constants');

/**
 * Parse comma-separated RPC URLs from env var, falling back to single URL.
 * Example: RPC_URL_AVALANCHE_LIST="https://api.avax.network/ext/bc/C/rpc,https://avalanche.llamarpc.com"
 */
function parseRpcUrls(listEnv, singleUrl) {
  if (listEnv) {
    const urls = listEnv.split(',').map(u => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return [singleUrl];
}

const avalancheRpcUrls = parseRpcUrls(
  process.env.RPC_URL_AVALANCHE_LIST || process.env.AVALANCHE_RPC_URLS,
  NETWORKS.AVALANCHE.rpcUrl
);

// Cache provider instances to avoid creating new connections per request
let _cachedProvider = null;

/**
 * Creates an Avalanche provider with FallbackProvider support.
 * Accepts optional overrides for batch settings (used by benqiRoutes).
 */
function createAvalancheProvider(options = {}) {
  const {
    rpcUrlOverride,
    batchMaxCount = 1,
    batchStallTime = 10,
  } = options;

  // If a specific override URL is given, create a single provider (no fallback)
  if (rpcUrlOverride) {
    return new ethers.JsonRpcProvider(rpcUrlOverride, {
      name: 'avalanche',
      chainId: 43114
    }, {
      staticNetwork: true,
      batchMaxCount,
      batchStallTime,
    });
  }

  // Return cached provider if available and no custom options
  if (_cachedProvider && batchMaxCount === 1 && batchStallTime === 10) {
    return _cachedProvider;
  }

  const network = ethers.Network.from(43114);

  if (avalancheRpcUrls.length === 1) {
    const provider = new ethers.JsonRpcProvider(avalancheRpcUrls[0], {
      name: 'avalanche',
      chainId: 43114
    }, {
      staticNetwork: true,
      batchMaxCount,
      batchStallTime,
    });

    if (batchMaxCount === 1 && batchStallTime === 10) {
      _cachedProvider = provider;
    }
    return provider;
  }

  // Multiple RPCs: FallbackProvider
  const rpcProviders = avalancheRpcUrls.map((url, index) => {
    const provider = new ethers.JsonRpcProvider(url, {
      name: 'avalanche',
      chainId: 43114,
    }, {
      staticNetwork: true,
      batchMaxCount,
      batchStallTime,
    });
    return {
      provider,
      priority: index + 1,
      stallTimeout: 2000,
      weight: 1,
    };
  });

  console.log(`[Provider] Avalanche: ${avalancheRpcUrls.length} RPC endpoints configured (fallback enabled)`);

  const fallback = new ethers.FallbackProvider(rpcProviders, network);

  if (batchMaxCount === 1 && batchStallTime === 10) {
    _cachedProvider = fallback;
  }
  return fallback;
}

/**
 * Creates a provider for Fuji testnet.
 */
function createFujiProvider() {
  const rpcUrl = NETWORKS.FUJI?.rpcUrl || 'https://api.avax-test.network/ext/bc/C/rpc';
  return new ethers.JsonRpcProvider(rpcUrl, {
    name: 'fuji',
    chainId: 43113
  }, { staticNetwork: true });
}

module.exports = {
  createAvalancheProvider,
  createFujiProvider,
  avalancheRpcUrls,
};
