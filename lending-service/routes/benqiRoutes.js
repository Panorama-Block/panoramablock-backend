const express = require('express');
const { ethers } = require('ethers');
const BenqiService = require('../services/benqiService');
const databaseGatewayClient = require('../services/databaseGatewayClient');
const { 
  verifySignature, 
  createRateLimiter,
  validateNetwork,
  sanitizeInput
} = require('../middleware/auth');
const { NETWORKS, BENQI } = require('../config/constants');
const { getCircuitBreaker } = require('../lib/circuitBreaker');

const router = express.Router();

// Rate limiting para rotas do Benqi
const benqiRateLimiter = createRateLimiter(100, 15 * 60 * 1000); // 100 requests por 15 minutos

// --- Performance guardrails (trust-first: cache is short-lived; on-chain remains source of truth) ---
const BENQI_MARKETS_CACHE_TTL_MS = Number(process.env.BENQI_MARKETS_CACHE_TTL_MS || 300_000); // 5min — APR/TVL data changes slowly
const BENQI_QTOKENS_CACHE_TTL_MS = Number(process.env.BENQI_QTOKENS_CACHE_TTL_MS || 300_000); // 5min — qToken list is near-static
const BENQI_POSITIONS_CACHE_TTL_MS = Math.max(5_000, Number(process.env.BENQI_POSITIONS_CACHE_TTL_MS || 20_000));
// Slightly higher concurrency reduces tail-latency for /benqi/markets without spamming the RPC.
const BENQI_MARKETS_CONCURRENCY = Math.max(1, Number(process.env.BENQI_MARKETS_CONCURRENCY || 6));
// Keep per-call timeouts tight so the endpoint completes quickly; return partial rows if a call times out.
const BENQI_RPC_TIMEOUT_MS = Math.max(500, Number(process.env.BENQI_RPC_TIMEOUT_MS || 2_500));
// Keep /positions responsive for proxies/frontends: prefer partial payload over long hangs.
const BENQI_POSITIONS_MAX_DURATION_MS = Math.max(2_000, Number(process.env.BENQI_POSITIONS_MAX_DURATION_MS || 8_000));
const BENQI_POSITIONS_CONCURRENCY = Math.max(1, Number(process.env.BENQI_POSITIONS_CONCURRENCY || 4));
const BENQI_BALANCE_TIMEOUT_MS = Math.max(500, Number(process.env.BENQI_BALANCE_TIMEOUT_MS || Math.min(BENQI_RPC_TIMEOUT_MS, 2_500)));
// Disable/limit JSON-RPC batching by default to reduce mixed batch failures on free/shared RPC tiers.
const BENQI_RPC_BATCH_MAX_COUNT = Math.max(1, Number(process.env.BENQI_RPC_BATCH_MAX_COUNT || 1));
const BENQI_RPC_BATCH_STALL_TIME_MS = Math.max(0, Number(process.env.BENQI_RPC_BATCH_STALL_TIME_MS || 10));
const BENQI_RATE_LIMIT_BACKOFF_MS = Math.max(100, Number(process.env.BENQI_RATE_LIMIT_BACKOFF_MS || 250));

let marketsCache = { ts: 0, payload: null };
let marketsInFlight = null;
let qTokensCache = { ts: 0, payload: null };
let qTokensInFlight = null;
const positionsCache = new Map();
const positionsInFlight = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      try {
        results[current] = await worker(items[current], current);
      } catch (e) {
        results[current] = { __error: e, __index: current };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

function isFresh(ts, ttlMs = BENQI_MARKETS_CACHE_TTL_MS) {
  return ts && (Date.now() - ts) < ttlMs;
}

function buildPositionsCacheKey(address, rpcUrl) {
  return `${String(address || '').toLowerCase()}::${String(rpcUrl || '').toLowerCase()}`;
}

function prunePositionsCache() {
  const entries = Array.from(positionsCache.entries());
  for (const [key, entry] of entries) {
    if (!entry || !isFresh(entry.ts, BENQI_POSITIONS_CACHE_TTL_MS)) {
      positionsCache.delete(key);
    }
  }

  // Safety bound for long-running processes with many unique wallets.
  if (positionsCache.size > 1000) {
    const overflow = positionsCache.size - 1000;
    let dropped = 0;
    for (const key of positionsCache.keys()) {
      positionsCache.delete(key);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  }
}

const { createAvalancheProvider: createAvalancheProviderBase } = require('../lib/provider');

function createAvalancheProvider(rpcUrlOverride) {
  return createAvalancheProviderBase({
    rpcUrlOverride,
    batchMaxCount: BENQI_RPC_BATCH_MAX_COUNT,
    batchStallTime: BENQI_RPC_BATCH_STALL_TIME_MS,
  });
}

function compactRpcError(err, max = 220) {
  const message = String(err?.message || err || 'Unknown RPC error').replace(/\s+/g, ' ').trim();
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

function isRateLimitedRpcError(err) {
  return /too many requests|rate.?limit|-32005|429|request limit/i.test(String(err?.message || err));
}

function isTimeoutRpcError(err) {
  return /timeout after \d+ms|request timeout|aborted/i.test(String(err?.message || err));
}

function normalizeUnderlyingSymbol(symbol, underlyingAddress) {
  // Benqi native market may surface as "iAVAX" depending on qToken symbol probing.
  if (underlyingAddress === 'native') return 'AVAX';
  if (typeof symbol === 'string' && symbol.toUpperCase() === 'IAVAX') return 'AVAX';
  return symbol;
}

// Fallback list (only used if comptroller market discovery fails).
// NOTE: Prefer on-chain discovery via comptroller.getAllMarkets() to avoid hardcoded/address drift.
const FALLBACK_BENQI_QTOKENS = [
  { symbol: 'qAVAX', address: BENQI.QAVAX, underlying: 'AVAX' },
  { symbol: 'qUSDC', address: BENQI.QUSDC, underlying: 'USDC' },
  { symbol: 'qUSDT', address: BENQI.QUSDT, underlying: 'USDT' },
  { symbol: 'qDAI', address: BENQI.QDAI, underlying: 'DAI' },
  { symbol: 'qWETH', address: BENQI.QWETH, underlying: 'WETH' },
  { symbol: 'qBTC', address: BENQI.QBTC, underlying: 'BTC.b' },
  { symbol: 'qLINK', address: BENQI.QLINK, underlying: 'LINK' },
  { symbol: 'qJOE', address: BENQI.QJOE, underlying: 'JOE' },
  { symbol: 'qQI', address: BENQI.QQI, underlying: 'QI' },
  { symbol: 'qCOQ', address: BENQI.QCOQ, underlying: 'COQ' }
].filter((m) => ethers.isAddress(m.address));

async function resolveBenqiQTokens({ benqiService, provider }) {
  if (qTokensCache.payload && isFresh(qTokensCache.ts, BENQI_QTOKENS_CACHE_TTL_MS)) {
    return qTokensCache.payload;
  }

  if (qTokensInFlight) {
    return qTokensInFlight;
  }

  const probeSymbols = async (addresses) => {
    const ABI = [
      'function symbol() external view returns (string)',
      'function comptroller() external view returns (address)',
    ];
    const callWithRateLimitRetry = async (callFn) => {
      try {
        return await withTimeout(callFn(), BENQI_RPC_TIMEOUT_MS);
      } catch (error) {
        if (!isRateLimitedRpcError(error)) throw error;
        await sleep(BENQI_RATE_LIMIT_BACKOFF_MS);
        return await withTimeout(callFn(), BENQI_RPC_TIMEOUT_MS);
      }
    };

    const valid = addresses.filter((addr) => ethers.isAddress(addr));
    const rows = await mapWithConcurrency(valid, BENQI_MARKETS_CONCURRENCY, async (addr, index) => {
      if (index > 0 && BENQI_RATE_LIMIT_BACKOFF_MS > 0) {
        const slot = index % BENQI_MARKETS_CONCURRENCY;
        if (slot > 0) {
          await sleep(Math.min(slot * 25, BENQI_RATE_LIMIT_BACKOFF_MS));
        }
      }
      const qToken = new ethers.Contract(addr, ABI, provider);
      const [symbol, comptroller] = await Promise.all([
        callWithRateLimitRetry(() => qToken.symbol()),
        callWithRateLimitRetry(() => qToken.comptroller()),
      ]);
      if (typeof symbol !== 'string' || symbol.length === 0) return null;
      if (!ethers.isAddress(comptroller)) return null;
      return { symbol, address: addr, underlying: symbol.replace(/^q/i, '') };
    });

    const skippedErrors = rows.filter((r) => r && r.__error);
    if (skippedErrors.length > 0) {
      const rateLimited = skippedErrors.filter((r) => isRateLimitedRpcError(r.__error)).length;
      console.warn(`[BENQI] probeSymbols skipped ${skippedErrors.length} market(s) due RPC/contract errors.`);
      if (rateLimited > 0) {
        console.warn(`[BENQI] probeSymbols detected ${rateLimited} RPC rate-limited call(s).`);
      }
    }

    return rows.filter((r) => {
      return (
        r &&
        !r.__error &&
        typeof r.symbol === 'string' &&
        r.symbol.length > 0 &&
        ethers.isAddress(r.address)
      );
    });
  };

  qTokensInFlight = (async () => {
    try {
      const addresses = await benqiService.getAllMarkets();
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error('empty market list');
      }
      const out = await probeSymbols(addresses);
      if (out.length === 0) {
        throw new Error('no valid markets after symbol probing');
      }

      qTokensCache = { ts: Date.now(), payload: out };
      return out;
    } catch (e) {
      console.warn('[BENQI] Falling back to static qToken list:', compactRpcError(e));
      // Even the fallback list can drift. Probe symbols and keep only valid markets.
      const validated = await probeSymbols(FALLBACK_BENQI_QTOKENS.map((m) => m.address));
      const fallbackResolved = validated.length > 0 ? validated : FALLBACK_BENQI_QTOKENS;
      qTokensCache = { ts: Date.now(), payload: fallbackResolved };
      return fallbackResolved;
    }
  })().finally(() => {
    qTokensInFlight = null;
  });

  return qTokensInFlight;
}

/**
 * @route GET /qtokens
 * @desc Lista todos os qTokens disponíveis
 * @access Public
 */
router.get('/qtokens', benqiRateLimiter, async (req, res) => {
  try {
    const rpcUrl = NETWORKS.AVALANCHE.rpcUrl;
    const provider = createAvalancheProvider(rpcUrl);
    const benqiService = new BenqiService(provider);
    const qTokens = await resolveBenqiQTokens({ benqiService, provider });

    res.json({
      status: 200,
      msg: 'success',
      data: {
        qTokens,
        total: qTokens.length,
        note: 'Lista de qTokens disponíveis no Benqi (preferencialmente descoberta on-chain via Comptroller.getAllMarkets())'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao listar qTokens:', error.message);
    res.status(500).json({
      status: 500,
      msg: 'error',
      data: {
        error: 'Erro ao listar qTokens',
        details: error.message
      }
    });
  }
});

/**
 * @route GET /markets
 * @desc Lista mercados (qToken + underlying) com metadados úteis para UI (APY, collateral factor, decimals)
 * @access Public
 */
router.get('/markets', async (req, res) => {
  try {
    if (marketsCache.payload && isFresh(marketsCache.ts)) {
      return res.json(marketsCache.payload);
    }

    if (marketsInFlight) {
      const payload = await marketsInFlight;
      return res.json(payload);
    }

    marketsInFlight = (async () => {
    const rpcUrl = NETWORKS.AVALANCHE.rpcUrl;
    const provider = createAvalancheProvider(rpcUrl);

    const benqiService = new BenqiService(provider);

    const ERC20_ABI = [
      'function decimals() external view returns (uint8)',
      'function symbol() external view returns (string)'
    ];

    const qTokensRaw = await resolveBenqiQTokens({ benqiService, provider });
    const qTokens = (Array.isArray(qTokensRaw) ? qTokensRaw : []).filter((m) => {
      return m && typeof m.symbol === 'string' && m.symbol.length > 0 && ethers.isAddress(m.address);
    });
    // Reuse a single comptroller instance for collateral factor reads.
    const comptroller = await benqiService.getComptroller().catch(() => null);

    const rows = await mapWithConcurrency(qTokens, BENQI_MARKETS_CONCURRENCY, async (market) => {
      const qTokenAddress = market.address;

      // Underlying resolution:
      // - For ERC20 markets, read underlying() from qToken.
      // - For native AVAX market, set underlyingAddress = "native".
      let underlyingAddress = null;
      try {
        underlyingAddress = await withTimeout(benqiService.getUnderlyingAddress(qTokenAddress), BENQI_RPC_TIMEOUT_MS);
      } catch {}
      if (!underlyingAddress && market.underlying === 'AVAX') {
        underlyingAddress = 'native';
      }

      let underlyingDecimals = 18;
      let underlyingSymbol = normalizeUnderlyingSymbol(market.underlying, underlyingAddress);

      if (underlyingAddress && underlyingAddress !== 'native') {
        try {
          const token = new ethers.Contract(underlyingAddress, ERC20_ABI, provider);
          const [dec, sym] = await Promise.all([
            withTimeout(token.decimals(), BENQI_RPC_TIMEOUT_MS),
            withTimeout(token.symbol().catch(() => null), BENQI_RPC_TIMEOUT_MS),
          ]);
          underlyingDecimals = Number(dec);
          if (sym && typeof sym === 'string') underlyingSymbol = sym;
        } catch (e) {
          // fall back to known defaults
        }
      }

      // Collateral factor (mantissa 1e18)
      let collateralFactorBps = null;
      if (comptroller) {
        try {
          const [, collateralFactorMantissa] = await withTimeout(comptroller.markets(qTokenAddress), BENQI_RPC_TIMEOUT_MS);
          const cf = parseFloat(ethers.formatUnits(collateralFactorMantissa, 18));
          if (Number.isFinite(cf)) {
            collateralFactorBps = Math.round(cf * 10000);
          }
        } catch {}
      }

      let rates = { supplyApyBps: null, borrowApyBps: null };
      try {
        rates = await withTimeout(benqiService.getInterestRates(qTokenAddress), BENQI_RPC_TIMEOUT_MS);
      } catch (e) {
        // Do not fail the entire endpoint because one market failed.
        console.warn(`[BENQI] Failed to fetch rates for ${market.symbol} (${qTokenAddress}):`, e?.message || e);
      }

      return {
        chainId: 43114,
        protocol: 'benqi',
        qTokenAddress,
        qTokenSymbol: market.symbol,
        underlyingAddress,
        underlyingSymbol,
        underlyingDecimals,
        collateralFactorBps,
        supplyApyBps: rates.supplyApyBps ?? null,
        borrowApyBps: rates.borrowApyBps ?? null,
      };
    });

    const markets = rows.filter((r) => r && !r.__error);
    const payload = {
      status: 200,
      msg: 'success',
      data: {
        markets,
        total: markets.length,
      },
      cached: false,
    };

    marketsCache = { ts: Date.now(), payload };
    if (databaseGatewayClient.isEnabled()) {
      databaseGatewayClient
        .syncMarkets(markets)
        .catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to sync markets:', e?.message || e));
    }
    return payload;
    })()
      .finally(() => {
        marketsInFlight = null;
      });

    const payload = await marketsInFlight;
    return res.json(payload);
  } catch (error) {
    marketsInFlight = null;
    console.error('❌ Erro ao listar mercados Benqi:', error.message);
    res.status(500).json({
      status: 500,
      msg: 'error',
      data: {
        error: 'Erro ao listar mercados Benqi',
        details: error.message
      }
    });
  }
});

/**
 * @route GET /qtokens/:address
 * @desc Obtém informações de um qToken específico
 * @access Public (com autenticação)
 */
router.get('/qtokens/:address', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço do qToken inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const qTokenInfo = await benqiService.getQTokenInfo(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: qTokenInfo
      });
    } catch (error) {
      console.error('❌ Erro ao obter informações do qToken:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter informações do qToken',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /qtokens/:address/rates
 * @desc Obtém taxas de juros de um qToken
 * @access Public (com autenticação)
 */
router.get('/qtokens/:address/rates', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço do qToken inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const rates = await benqiService.getInterestRates(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: rates
      });
    } catch (error) {
      console.error('❌ Erro ao obter taxas de juros:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter taxas de juros',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/liquidity
 * @desc Obtém liquidez da conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/liquidity', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const liquidity = await withTimeout(
        benqiService.getAccountLiquidity(address),
        BENQI_RPC_TIMEOUT_MS
      );
      
      res.json({
        status: 200,
        msg: 'success',
        data: liquidity
      });
    } catch (error) {
      const compact = compactRpcError(error);
      const rateLimited = isRateLimitedRpcError(error);
      console.warn('❌ Erro ao obter liquidez da conta:', compact);

      if (rateLimited) {
        return res.json({
          status: 200,
          msg: 'success',
          degraded: true,
          data: {
            accountAddress: req.params.address,
            errorCode: '0',
            liquidity: '0',
            shortfall: '0',
            isHealthy: true,
            warnings: ['RPC temporarily rate-limited while fetching liquidity.'],
          }
        });
      }

      res.status(503).json({
        status: 503,
        msg: 'error',
        data: {
          error: 'Erro ao obter liquidez da conta',
          details: 'Liquidity temporarily unavailable.'
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/assets
 * @desc Obtém ativos em uso pela conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/assets', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const assets = await withTimeout(
        benqiService.getAssetsIn(address),
        BENQI_RPC_TIMEOUT_MS
      );
      
      res.json({
        status: 200,
        msg: 'success',
        data: assets
      });
    } catch (error) {
      const compact = compactRpcError(error);
      const rateLimited = isRateLimitedRpcError(error);
      console.warn('❌ Erro ao obter ativos da conta:', compact);

      if (rateLimited) {
        return res.json({
          status: 200,
          msg: 'success',
          degraded: true,
          data: {
            accountAddress: req.params.address,
            assets: [],
            count: 0,
            warnings: ['RPC temporarily rate-limited while fetching collateral markets.'],
          }
        });
      }

      res.status(503).json({
        status: 503,
        msg: 'error',
        data: {
          error: 'Erro ao obter ativos da conta',
          details: 'Assets temporarily unavailable.'
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/balance/:qTokenAddress
 * @desc Obtém saldo de um qToken para uma conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/balance/:qTokenAddress', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address, qTokenAddress } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address) || !ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereços inválidos',
            address,
            qTokenAddress
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const balance = await benqiService.getQTokenBalance(qTokenAddress, address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: balance
      });
    } catch (error) {
      console.error('❌ Erro ao obter saldo do qToken:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter saldo do qToken',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/borrow/:qTokenAddress
 * @desc Obtém saldo de empréstimo de um qToken
 * @access Public (com autenticação)
 */
router.get('/account/:address/borrow/:qTokenAddress', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address, qTokenAddress } = req.params;
      const { rpc } = req.body || {};
      
      if (!ethers.isAddress(address) || !ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereços inválidos',
            address,
            qTokenAddress
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const borrowBalance = await benqiService.getBorrowBalance(qTokenAddress, address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: borrowBalance
      });
    } catch (error) {
      console.error('❌ Erro ao obter saldo de empréstimo:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter saldo de empréstimo',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/info
 * @desc Obtém informações completas da conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/info', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body || {};

      // If authenticated via JWT, enforce that the requested account matches the session address.
      if (req.verifiedAddress && address && req.verifiedAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(403).json({
          status: 403,
          msg: 'error',
          data: {
            error: 'Forbidden',
            details: 'Requested account does not match authenticated session.',
          }
        });
      }
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider);
      const accountInfo = await benqiService.getAccountInfo(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: accountInfo
      });
    } catch (error) {
      console.error('❌ Erro ao obter informações da conta:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter informações da conta',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/positions
 * @desc Posições normalizadas por ativo (supplied/borrowed + collateral enabled + decimals)
 * @access Private (JWT/signature required, on-chain read)
 */
router.get('/account/:address/positions',
  verifySignature,
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const rpc = req.query?.rpc || req.body?.rpc;

      if (req.verifiedAddress && address && req.verifiedAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(403).json({
          status: 403,
          msg: 'error',
          data: {
            error: 'Forbidden',
            details: 'Requested account does not match authenticated session.',
          }
        });
      }

      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const cacheKey = buildPositionsCacheKey(address, rpcUrl);

      prunePositionsCache();
      const cached = positionsCache.get(cacheKey);
      if (cached && isFresh(cached.ts, BENQI_POSITIONS_CACHE_TTL_MS)) {
        return res.json(cached.payload);
      }

      const inFlight = positionsInFlight.get(cacheKey);
      if (inFlight) {
        const payload = await inFlight;
        return res.json(payload);
      }

      const computePromise = (async () => {
        const provider = createAvalancheProvider(rpcUrl);
        const benqiService = new BenqiService(provider);
        const warnings = [];

        const ERC20_ABI = [
          'function decimals() external view returns (uint8)',
          'function symbol() external view returns (string)'
        ];

        let liquidity = {
          accountAddress: address,
          errorCode: '0',
          liquidity: '0',
          shortfall: '0',
          isHealthy: true,
        };
        let assetsIn = {
          accountAddress: address,
          assets: [],
          count: 0,
        };

        try {
          liquidity = await withTimeout(
            benqiService.getAccountLiquidity(address),
            BENQI_RPC_TIMEOUT_MS
          );
        } catch (e) {
          console.warn('[BENQI] getAccountLiquidity failed (serving degraded positions):', compactRpcError(e));
          warnings.push(
            isRateLimitedRpcError(e)
              ? 'RPC rate limited while fetching liquidity. Returning partial positions.'
              : isTimeoutRpcError(e)
                ? 'Liquidity request timed out. Returning partial positions.'
                : 'Liquidity temporarily unavailable. Returning partial positions.'
          );
        }

        try {
          assetsIn = await withTimeout(
            benqiService.getAssetsIn(address),
            BENQI_RPC_TIMEOUT_MS
          );
        } catch (e) {
          console.warn('[BENQI] getAssetsIn failed (serving degraded positions):', compactRpcError(e));
          warnings.push(
            isRateLimitedRpcError(e)
              ? 'RPC rate limited while fetching collateral markets.'
              : isTimeoutRpcError(e)
                ? 'Collateral markets request timed out.'
                : 'Collateral markets temporarily unavailable.'
          );
        }

        const collateralSet = new Set((assetsIn?.assets || []).map((a) => String(a).toLowerCase()));

        const positions = [];

        let qTokens = [];
        try {
          const qTokensRaw = await resolveBenqiQTokens({ benqiService, provider });
          qTokens = (Array.isArray(qTokensRaw) ? qTokensRaw : []).filter((m) => {
            return m && typeof m.symbol === 'string' && m.symbol.length > 0 && ethers.isAddress(m.address);
          });
        } catch (e) {
          console.warn('[BENQI] Failed to resolve qTokens for positions:', compactRpcError(e));
          warnings.push(
            isRateLimitedRpcError(e)
              ? 'RPC rate limited while listing markets. Returning partial position set.'
              : isTimeoutRpcError(e)
                ? 'Market discovery timed out. Returning partial position set.'
                : 'Markets temporarily unavailable. Returning partial position set.'
          );
        }

        let rateLimitHits = 0;
        let timeoutHits = 0;
        const MAX_RATE_LIMIT_HITS = 3;
        const MAX_TIMEOUT_HITS = 4;
        let stopProcessing = false;
        const positionsDeadlineAt = Date.now() + BENQI_POSITIONS_MAX_DURATION_MS;
        const addWarning = (message) => {
          if (message && !warnings.includes(message)) {
            warnings.push(message);
          }
        };

        const rows = await mapWithConcurrency(qTokens, BENQI_POSITIONS_CONCURRENCY, async (market) => {
          if (stopProcessing || req.aborted || req.destroyed) {
            return null;
          }
          if (Date.now() > positionsDeadlineAt) {
            stopProcessing = true;
            addWarning('Positions request deadline reached. Returned partial position set.');
            return null;
          }

          const qTokenAddress = market.address;
          if (!ethers.isAddress(qTokenAddress)) {
            return null;
          }

          // Underlying resolution (same logic as /markets)
          let underlyingAddress = null;
          try {
            underlyingAddress = await withTimeout(
              benqiService.getUnderlyingAddress(qTokenAddress),
              BENQI_RPC_TIMEOUT_MS
            );
          } catch {}
          if (!underlyingAddress && market.underlying === 'AVAX') {
            underlyingAddress = 'native';
          }

          let underlyingDecimals = 18;
          let underlyingSymbol = normalizeUnderlyingSymbol(market.underlying, underlyingAddress);

          if (underlyingAddress && underlyingAddress !== 'native') {
            try {
              const token = new ethers.Contract(underlyingAddress, ERC20_ABI, provider);
              const [dec, sym] = await withTimeout(
                Promise.all([
                  token.decimals(),
                  token.symbol().catch(() => null),
                ]),
                BENQI_RPC_TIMEOUT_MS
              );
              underlyingDecimals = Number(dec);
              if (sym && typeof sym === 'string') underlyingSymbol = sym;
            } catch {}
          }

          let qTokenDecimals = 8;
          try {
            const qTokenContract = new ethers.Contract(qTokenAddress, ERC20_ABI, provider);
            const dec = await withTimeout(qTokenContract.decimals(), BENQI_RPC_TIMEOUT_MS);
            qTokenDecimals = Number(dec);
          } catch {}

          let supply = null;
          let borrow = null;
          try {
            [supply, borrow] = await withTimeout(
              Promise.all([
                benqiService.getQTokenBalance(qTokenAddress, address),
                benqiService.getBorrowBalance(qTokenAddress, address),
              ]),
              BENQI_BALANCE_TIMEOUT_MS
            );
          } catch (e) {
            // Skip markets that error on snapshot calls.
            console.warn(`[BENQI] Failed to fetch balances for ${market.symbol} (${qTokenAddress}):`, compactRpcError(e));
            if (isRateLimitedRpcError(e)) {
              rateLimitHits += 1;
              if (rateLimitHits >= MAX_RATE_LIMIT_HITS) {
                addWarning('RPC rate limit reached while fetching balances. Returned partial position set.');
                stopProcessing = true;
              }
            }
            if (isTimeoutRpcError(e)) {
              timeoutHits += 1;
              if (timeoutHits >= MAX_TIMEOUT_HITS) {
                addWarning('RPC timeout threshold reached while fetching balances. Returned partial position set.');
                stopProcessing = true;
              }
            }
            return null;
          }

          const suppliedWei = supply?.underlyingBalance || '0';
          const qTokenBalanceWei = supply?.qTokenBalance || '0';
          const borrowedWei = borrow?.borrowBalance || '0';
          const supplied = BigInt(suppliedWei || '0');
          const borrowed = BigInt(borrowedWei || '0');
          const qTokenBalance = BigInt(qTokenBalanceWei || '0');

          if (supplied === 0n && borrowed === 0n && qTokenBalance === 0n) {
            return null;
          }

          return {
            chainId: 43114,
            protocol: 'benqi',
            qTokenAddress,
            qTokenSymbol: market.symbol,
            underlyingAddress,
            underlyingSymbol,
            underlyingDecimals,
            qTokenDecimals,
            qTokenBalanceWei,
            suppliedWei,
            borrowedWei,
            collateralEnabled: collateralSet.has(String(qTokenAddress).toLowerCase()),
          };
        });

        for (const row of rows) {
          if (row && !row.__error) {
            positions.push(row);
          }
        }

        const responsePayload = {
          status: 200,
          msg: 'success',
          data: {
            accountAddress: address,
            liquidity,
            positions,
            updatedAt: Date.now(),
            ...(warnings.length ? { warnings } : {}),
          }
        };

        if (databaseGatewayClient.isEnabled()) {
          databaseGatewayClient
            .syncAccountPositions(address, responsePayload.data)
            .catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to sync positions:', e?.message || e));
        }

        return responsePayload;
      })();

      positionsInFlight.set(cacheKey, computePromise);

      let responsePayload;
      try {
        responsePayload = await computePromise;
      } finally {
        positionsInFlight.delete(cacheKey);
      }

      positionsCache.set(cacheKey, { ts: Date.now(), payload: responsePayload });
      prunePositionsCache();
      return res.json(responsePayload);
    } catch (error) {
      console.error('❌ Erro ao obter posições da conta:', compactRpcError(error));
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter posições da conta',
          details: isRateLimitedRpcError(error)
            ? 'RPC temporarily rate-limited while fetching positions.'
            : isTimeoutRpcError(error)
              ? 'RPC timeout while fetching positions.'
              : 'Positions temporarily unavailable.'
        }
      });
    }
  }
);

/**
 * @route POST /supply
 * @desc Prepara transação de supply (depósito)
 * @access Private (com transação assinada)
 */
router.post('/supply', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const cb = getCircuitBreaker(43114);
      const transactionData = await cb.execute(() => benqiService.prepareSupply(qTokenAddress, amount));

      // Record pending transaction
      if (databaseGatewayClient.isEnabled()) {
        databaseGatewayClient.recordTransaction({
          userId: req.verifiedAddress,
          chainId: 43114,
          action: 'supply',
          amountWei: amount,
          status: 'pending',
          metadata: { qTokenAddress, referenceId: transactionData?.referenceId },
        }).catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to record supply tx:', e.message));
      }

      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('Erro ao preparar supply:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar supply',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /redeem
 * @desc Prepara transação de redeem (saque)
 * @access Private (com transação assinada)
 */
router.post('/redeem', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, isUnderlying, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const cb = getCircuitBreaker(43114);
      const shouldUseUnderlyingAmount = typeof isUnderlying === 'boolean' ? isUnderlying : true;
      const transactionData = await cb.execute(() => benqiService.prepareRedeem(qTokenAddress, amount, shouldUseUnderlyingAmount));

      if (databaseGatewayClient.isEnabled()) {
        databaseGatewayClient.recordTransaction({
          userId: req.verifiedAddress,
          chainId: 43114,
          action: 'redeem',
          amountWei: amount,
          status: 'pending',
          metadata: { qTokenAddress, isUnderlying: shouldUseUnderlyingAmount, referenceId: transactionData?.referenceId },
        }).catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to record redeem tx:', e.message));
      }

      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('Erro ao preparar redeem:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar redeem',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /borrow
 * @desc Prepara transação de borrow (empréstimo)
 * @access Private (com transação assinada)
 */
router.post('/borrow', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const cb = getCircuitBreaker(43114);
      const transactionData = await cb.execute(() => benqiService.prepareBorrow(qTokenAddress, amount));

      if (databaseGatewayClient.isEnabled()) {
        databaseGatewayClient.recordTransaction({
          userId: req.verifiedAddress,
          chainId: 43114,
          action: 'borrow',
          amountWei: amount,
          status: 'pending',
          metadata: { qTokenAddress, referenceId: transactionData?.referenceId },
        }).catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to record borrow tx:', e.message));
      }

      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('Erro ao preparar borrow:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar borrow',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /repay
 * @desc Prepara transação de repay (pagamento de empréstimo)
 * @access Private (com transação assinada)
 */
router.post('/repay', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const cb = getCircuitBreaker(43114);
      const transactionData = await cb.execute(() => benqiService.prepareRepay(qTokenAddress, amount));

      if (databaseGatewayClient.isEnabled()) {
        databaseGatewayClient.recordTransaction({
          userId: req.verifiedAddress,
          chainId: 43114,
          action: 'repay',
          amountWei: amount,
          status: 'pending',
          metadata: { qTokenAddress, referenceId: transactionData?.referenceId },
        }).catch((e) => console.warn('[BENQI][DB-GATEWAY] Failed to record repay tx:', e.message));
      }

      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('Erro ao preparar repay:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar repay',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /enterMarkets
 * @desc Prepara transação de enterMarkets
 * @access Private (com transação assinada)
 */
router.post('/enterMarkets', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddresses, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddresses || !Array.isArray(qTokenAddresses) || qTokenAddresses.length === 0) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddresses deve ser um array não vazio'
          }
        });
      }

      // Valida todos os endereços
      for (const address of qTokenAddresses) {
        if (!ethers.isAddress(address)) {
          return res.status(400).json({
            status: 400,
            msg: 'error',
            data: {
              error: 'Endereço de qToken inválido',
              address
            }
          });
        }
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareEnterMarkets(qTokenAddresses);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar enterMarkets:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar enterMarkets',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /exitMarket
 * @desc Prepara transação de exitMarket
 * @access Private (com transação assinada)
 */
router.post('/exitMarket', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress é obrigatório'
          }
        });
      }

      if (!ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço de qToken inválido',
            qTokenAddress
          }
        });
      }

      const rpcUrl = rpc || NETWORKS.AVALANCHE.rpcUrl;
      const provider = createAvalancheProvider(rpcUrl);

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareExitMarket(qTokenAddress);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar exitMarket:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar exitMarket',
          details: error.message
        }
      });
    }
  }
);

// ─── History & Portfolio Endpoints ──────────────────────────────────

/**
 * @route GET /account/:address/history
 * @desc Returns lending transaction history from the database gateway
 */
router.get('/account/:address/history',
  verifySignature,
  async (req, res) => {
    try {
      if (!databaseGatewayClient.isEnabled()) {
        return res.json({ status: 200, msg: 'success', data: { transactions: [], message: 'History not available (DB gateway disabled)' } });
      }
      const userId = req.params.address.toLowerCase();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const result = await databaseGatewayClient.listEntities('lending-txs', {
        userId,
        tenantId: databaseGatewayClient.tenantId,
        _sort: 'createdAt',
        _order: 'desc',
        _limit: limit,
      });
      const transactions = Array.isArray(result) ? result : (result?.data || []);
      res.json({ status: 200, msg: 'success', data: { transactions } });
    } catch (error) {
      console.error('Error fetching lending history:', error.message);
      res.json({ status: 200, msg: 'success', data: { transactions: [], message: 'Failed to fetch history' } });
    }
  }
);

/**
 * @route GET /account/:address/snapshots
 * @desc Returns daily position snapshots for portfolio tracking
 */
router.get('/account/:address/snapshots',
  verifySignature,
  async (req, res) => {
    try {
      if (!databaseGatewayClient.isEnabled()) {
        return res.json({ status: 200, msg: 'success', data: { snapshots: [], message: 'Snapshots not available (DB gateway disabled)' } });
      }
      const userId = req.params.address.toLowerCase();
      const days = Math.min(parseInt(req.query.days) || 30, 365);
      const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const result = await databaseGatewayClient.listEntities('lending-snapshots', {
        userId,
        tenantId: databaseGatewayClient.tenantId,
        _sort: 'date',
        _order: 'asc',
        'date_gte': `${sinceDate}T00:00:00.000Z`,
        _limit: days,
      });
      const snapshots = Array.isArray(result) ? result : (result?.data || []);
      res.json({ status: 200, msg: 'success', data: { snapshots } });
    } catch (error) {
      console.error('Error fetching lending snapshots:', error.message);
      res.json({ status: 200, msg: 'success', data: { snapshots: [], message: 'Failed to fetch snapshots' } });
    }
  }
);

module.exports = router;
