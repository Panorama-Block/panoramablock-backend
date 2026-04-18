/**
 * Execution Layer Proxy Routes
 *
 * These routes replace the legacy benqi + benqiValidation routes when the
 * EXECUTION_LAYER_URL env var is set. The miniapp payload is identical —
 * the routing decision (which chain / contract) is made here, transparently.
 *
 * Supported actions: supply, withdraw (redeem), borrow, repay
 * Supported views:   markets, position
 * Extra:             liquid-staking (stake, requestUnlock, redeem)
 */

const express = require('express');
const router = express.Router();

const EXECUTION_LAYER_URL = process.env.EXECUTION_LAYER_URL || 'http://localhost:3011';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when the error looks like the execution layer is down or returned garbage. */
function isServiceError(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  return ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'FETCH_ERROR']
    .includes(code)
    || /fetch failed|ECONNREFUSED|Unexpected token|not valid JSON/i.test(err?.message ?? '');
}

/** Safely parse JSON from a fetch response; throws on non-2xx or non-JSON bodies. */
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
}

async function proxyToExecutionLayer(path, body) {
  const res = await fetch(`${EXECUTION_LAYER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return safeJson(res);
}

async function getFromExecutionLayer(path) {
  const res = await fetch(`${EXECUTION_LAYER_URL}${path}`);
  return safeJson(res);
}

/**
 * Maps execution layer TransactionBundle steps to the format the miniapp
 * lending API expects: { actionKey: { to, data, value, chainId, ... }, approve?: { ... } }
 *
 * The miniapp's safeExecuteTransactionV2 iterates and signs each transaction.
 * It looks for `supply`, `borrow`, `redeem`, `repay` keys in the response data.
 */
function mapBundleToLendingResponse(bundle, actionKey) {
  const steps = bundle?.steps ?? [];
  const result = { validation: null, walletType: 'smart_wallet', requiresSignature: true };

  if (steps.length === 0) return result;

  // If there are 2 steps, first is approve and second is the main action
  if (steps.length >= 2) {
    result.approve = {
      ...steps[0],
      walletType: 'smart_wallet',
      requiresSignature: true,
    };
    result[actionKey] = {
      ...steps[1],
      walletType: 'smart_wallet',
      requiresSignature: true,
    };
  } else {
    result[actionKey] = {
      ...steps[0],
      walletType: 'smart_wallet',
      requiresSignature: true,
    };
  }

  return result;
}

// ─── Markets ─────────────────────────────────────────────────────────────────

/**
 * GET /benqi/markets
 * Proxies to execution layer /avax/lending/markets
 */
router.get('/benqi/markets', async (req, res, next) => {
  try {
    const data = await getFromExecutionLayer('/avax/lending/markets');
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) {
    if (isServiceError(err)) {
      console.warn('[executionLayerProxy] execution layer unreachable, falling back to legacy route');
      return next('route');
    }
    console.error('[executionLayerProxy] markets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch markets from execution layer' });
  }
});

/**
 * GET /benqi/account/:address
 * Proxies to execution layer /avax/lending/position/:address
 */
router.get('/benqi/account/:address', async (req, res, next) => {
  try {
    const data = await getFromExecutionLayer(`/avax/lending/position/${req.params.address}`);
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) {
    if (isServiceError(err)) {
      console.warn('[executionLayerProxy] execution layer unreachable, falling back to legacy route');
      return next('route');
    }
    console.error('[executionLayerProxy] account position error:', err.message);
    res.status(500).json({ error: 'Failed to fetch position from execution layer' });
  }
});

/**
 * GET /benqi/account/:address/positions
 * Returns lending positions in the format expected by the miniapp LendingApiClient.
 * Maps execution layer /avax/lending/position/:address → { data: LendingAccountPositionsResponse }
 */
router.get('/benqi/account/:address/positions', async (req, res, next) => {
  try {
    const address = req.params.address;
    const data = await getFromExecutionLayer(`/avax/lending/position/${address}`);
    if (data.error) return res.status(500).json({ error: data.error });

    const positions = (data.positions || []).map((p) => ({
      chainId: 43114,
      protocol: 'benqi',
      qTokenAddress: p.qTokenAddress,
      qTokenSymbol: p.qTokenSymbol,
      underlyingAddress: p.underlyingAddress ?? 'native',
      underlyingSymbol: p.underlyingSymbol,
      underlyingDecimals: p.underlyingDecimals ?? 18,
      qTokenDecimals: 8,
      qTokenBalanceWei: p.qTokenBalance,
      suppliedWei: p.suppliedWei ?? '0',
      borrowedWei: p.borrowedWei ?? '0',
      collateralEnabled: true,
    }));

    res.json({
      data: {
        accountAddress: address,
        liquidity: { accountAddress: address, liquidity: '0', shortfall: '0', isHealthy: true },
        positions,
        updatedAt: Date.now(),
      },
    });
  } catch (err) {
    if (isServiceError(err)) {
      console.warn('[executionLayerProxy] execution layer unreachable, falling back to legacy route');
      return next('route');
    }
    console.error('[executionLayerProxy] account positions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch positions from execution layer' });
  }
});

// ─── Lending Actions ─────────────────────────────────────────────────────────

/**
 * POST /benqi-validation/validateAndSupply
 * Body: { address, amount, qTokenAddress }
 */
router.post('/benqi-validation/validateAndSupply', async (req, res) => {
  try {
    const { address, amount, qTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/avax/lending/prepare-supply', {
      userAddress: address,
      qTokenAddress,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'supply') });
  } catch (err) {
    console.error('[executionLayerProxy] supply error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Supply preparation failed' } });
  }
});

/**
 * POST /benqi-validation/validateAndWithdraw
 * Body: { address, qTokenAmount, qTokenAddress }
 */
router.post('/benqi-validation/validateAndWithdraw', async (req, res) => {
  try {
    const { address, qTokenAmount, qTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/avax/lending/prepare-redeem', {
      userAddress: address,
      qTokenAddress,
      qTokenAmount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'redeem') });
  } catch (err) {
    console.error('[executionLayerProxy] withdraw error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Withdraw preparation failed' } });
  }
});

/**
 * POST /benqi-validation/validateAndBorrow
 * Body: { address, amount, qTokenAddress }
 */
router.post('/benqi-validation/validateAndBorrow', async (req, res) => {
  try {
    const { address, amount, qTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/avax/lending/prepare-borrow', {
      userAddress: address,
      qTokenAddress,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'borrow') });
  } catch (err) {
    console.error('[executionLayerProxy] borrow error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Borrow preparation failed' } });
  }
});

/**
 * POST /benqi-validation/validateAndRepay
 * Body: { address, amount, qTokenAddress }
 */
router.post('/benqi-validation/validateAndRepay', async (req, res) => {
  try {
    const { address, amount, qTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/avax/lending/prepare-repay', {
      userAddress: address,
      qTokenAddress,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'repay') });
  } catch (err) {
    console.error('[executionLayerProxy] repay error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Repay preparation failed' } });
  }
});

// ─── Quote endpoints (passthrough — no tx prepared, just info) ────────────────

router.post('/benqi-validation/getValidationAndSupplyQuote', async (req, res) => {
  try {
    const { address, amount, qTokenAddress } = req.body;
    // Execution layer doesn't have a quote-only endpoint for lending,
    // so we return a passthrough that gives the same amount (no fee taken)
    res.json({
      status: 200,
      data: {
        validation: null,
        supply: { estimatedAmount: amount, qTokenAddress, walletType: 'smart_wallet' },
        summary: { totalAmount: amount, taxPaid: '0', supplyAmount: amount, finalAmount: amount, totalFees: '0' },
        validationBypassed: true,
      },
    });
  } catch (err) {
    res.status(500).json({ status: 500, data: { error: 'Quote failed' } });
  }
});

router.post('/benqi-validation/getValidationAndBorrowQuote', async (req, res) => {
  try {
    const { address, amount, qTokenAddress } = req.body;
    res.json({
      status: 200,
      data: {
        validation: null,
        borrow: { estimatedAmount: amount, qTokenAddress, walletType: 'smart_wallet' },
        summary: { totalAmount: amount, taxPaid: '0', borrowAmount: amount, finalAmount: amount, totalFees: '0' },
        validationBypassed: true,
      },
    });
  } catch (err) {
    res.status(500).json({ status: 500, data: { error: 'Quote failed' } });
  }
});

// ─── Moonwell (Base) ──────────────────────────────────────────────────────────

/**
 * GET /moonwell/markets
 * Proxies to execution layer /base/lending/markets
 */
router.get('/moonwell/markets', async (req, res) => {
  try {
    const data = await getFromExecutionLayer('/base/lending/markets');
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) {
    console.error('[executionLayerProxy] moonwell markets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Moonwell markets from execution layer' });
  }
});

/**
 * GET /moonwell/account/:address
 * Proxies to execution layer /base/lending/position/:address
 */
router.get('/moonwell/account/:address', async (req, res) => {
  try {
    const data = await getFromExecutionLayer(`/base/lending/position/${req.params.address}`);
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) {
    console.error('[executionLayerProxy] moonwell position error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Moonwell position from execution layer' });
  }
});

/**
 * GET /moonwell/account/:address/positions
 * Returns Moonwell positions in the format expected by the miniapp LendingApiClient.
 */
router.get('/moonwell/account/:address/positions', async (req, res) => {
  try {
    const address = req.params.address;
    const data = await getFromExecutionLayer(`/base/lending/position/${address}`);
    if (data.error) return res.status(500).json({ error: data.error });

    const positions = (data.positions || []).map((p) => ({
      chainId: 8453,
      protocol: 'moonwell',
      mTokenAddress: p.mTokenAddress,
      mTokenSymbol: p.mTokenSymbol,
      underlyingAddress: p.underlyingAddress,
      underlyingSymbol: p.underlyingSymbol,
      underlyingDecimals: p.underlyingDecimals ?? 18,
      mTokenDecimals: 8,
      mTokenBalanceWei: p.mTokenBalance,
      suppliedWei: p.suppliedWei ?? '0',
      borrowedWei: p.borrowedWei ?? '0',
      collateralEnabled: true,
    }));

    res.json({
      data: {
        accountAddress: address,
        liquidity: { accountAddress: address, liquidity: '0', shortfall: '0', isHealthy: true },
        positions,
        updatedAt: Date.now(),
      },
    });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell positions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Moonwell positions from execution layer' });
  }
});

/**
 * POST /moonwell/validateAndSupply
 * Body: { address, amount, mTokenAddress, useNativeETH? }
 */
router.post('/moonwell/validateAndSupply', async (req, res) => {
  try {
    const { address, amount, mTokenAddress, useNativeETH } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-supply', {
      userAddress: address,
      mTokenAddress,
      amount,
      useNativeETH,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'supply') });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell supply error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell supply preparation failed' } });
  }
});

/**
 * POST /moonwell/validateAndWithdraw
 * Body: { address, amount, mTokenAddress, useNativeETH? }
 */
router.post('/moonwell/validateAndWithdraw', async (req, res) => {
  try {
    const { address, amount, mTokenAddress, useNativeETH } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-redeem', {
      userAddress: address,
      mTokenAddress,
      amount,
      useNativeETH,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'redeem') });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell withdraw error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell redeem preparation failed' } });
  }
});

/**
 * POST /moonwell/validateAndBorrow
 * Body: { address, amount, mTokenAddress, useNativeETH? }
 */
router.post('/moonwell/validateAndBorrow', async (req, res) => {
  try {
    const { address, amount, mTokenAddress, useNativeETH } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-borrow', {
      userAddress: address,
      mTokenAddress,
      amount,
      useNativeETH,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'borrow') });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell borrow error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell borrow preparation failed' } });
  }
});

/**
 * POST /moonwell/validateAndRepay
 * Body: { address, amount, mTokenAddress, useNativeETH? }
 */
router.post('/moonwell/validateAndRepay', async (req, res) => {
  try {
    const { address, amount, mTokenAddress, useNativeETH } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-repay', {
      userAddress: address,
      mTokenAddress,
      amount,
      useNativeETH,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: mapBundleToLendingResponse(data.bundle, 'repay') });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell repay error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell repay preparation failed' } });
  }
});

/**
 * POST /moonwell/prepareSupplyWithPermit
 * Returns { permitMessage, executeCalldata, permitTarget, executorAddress, chainId, metadata }.
 * If permitMessage is null, the token does not support EIP-2612 — fall back to validateAndSupply.
 * Body: { address, amount, mTokenAddress }
 */
router.post('/moonwell/prepareSupplyWithPermit', async (req, res) => {
  try {
    const { address, amount, mTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-supply-with-permit', {
      userAddress: address,
      mTokenAddress,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell prepareSupplyWithPermit error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell permit preparation failed' } });
  }
});

/**
 * POST /moonwell/finalizeSupplyPermit
 * Takes the permit signature and returns a single Multicall3 bundle (permit + execute).
 * Body: { address, permitMessage, signature, executeCalldata, executorAddress }
 */
router.post('/moonwell/finalizeSupplyPermit', async (req, res) => {
  try {
    const { address, permitMessage, signature, executeCalldata, executorAddress } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/finalize-supply-permit', {
      userAddress: address,
      permitMessage,
      signature,
      executeCalldata,
      executorAddress,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    // Return the bundle directly so the frontend can execute it
    res.json({ status: 200, data: { bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell finalizeSupplyPermit error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell permit finalization failed' } });
  }
});

/**
 * POST /moonwell/prepareRepayWithPermit
 * Body: { address, amount, mTokenAddress }
 */
router.post('/moonwell/prepareRepayWithPermit', async (req, res) => {
  try {
    const { address, amount, mTokenAddress } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-repay-with-permit', {
      userAddress: address,
      mTokenAddress,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell prepareRepayWithPermit error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell repay permit preparation failed' } });
  }
});

/**
 * POST /moonwell/finalizeRepayPermit
 * Body: { address, permitMessage, signature, executeCalldata, executorAddress }
 */
router.post('/moonwell/finalizeRepayPermit', async (req, res) => {
  try {
    const { address, permitMessage, signature, executeCalldata, executorAddress } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/finalize-repay-permit', {
      userAddress: address,
      permitMessage,
      signature,
      executeCalldata,
      executorAddress,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: { bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell finalizeRepayPermit error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'Moonwell repay permit finalization failed' } });
  }
});

/**
 * POST /moonwell/recoverEth
 * Builds a sweepETH transaction to recover native ETH stranded in the user's
 * MoonwellLendAdapter proxy (caused by the now-fixed ERC20 redeem bug on mWETH).
 * Body: { address }
 */
router.post('/moonwell/recoverEth', async (req, res) => {
  try {
    const { address } = req.body;
    const data = await proxyToExecutionLayer('/base/lending/prepare-sweep-eth', {
      userAddress: address,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    // Return the raw bundle so the frontend can execute it directly
    res.json({ status: 200, data: { bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    console.error('[executionLayerProxy] moonwell recoverEth error:', err.message);
    res.status(500).json({ status: 500, data: { error: 'ETH recovery preparation failed' } });
  }
});

// ─── Liquid Staking (AVAX → sAVAX via PanoramaLiquidStaking) ─────────────────

// sAVAX on Avalanche C-Chain
const SAVAX_ADDRESS = '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE';
const SAVAX_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function getPooledAvaxByShares(uint256) view returns (uint256)',
];

/** Lightweight on-chain fallback for liquid-staking position when execution layer is down. */
async function getPositionFallback(userAddress) {
  const { createAvalancheProvider } = require('../lib/provider');
  const provider = createAvalancheProvider();
  const sAvax = new ethers.Contract(SAVAX_ADDRESS, SAVAX_ABI, provider);

  const balance = await sAvax.balanceOf(userAddress);
  const avaxValue = balance > 0n ? await sAvax.getPooledAvaxByShares(balance) : 0n;

  return {
    userAddress,
    sAvaxBalance: balance.toString(),
    avaxEquivalent: avaxValue.toString(),
    exchangeRate: balance > 0n ? (Number(avaxValue) / Number(balance)).toFixed(6) : '1.0',
    pendingUnlocks: [],
  };
}

/**
 * GET /liquid-staking/position/:address
 */
router.get('/liquid-staking/position/:address', async (req, res) => {
  try {
    const data = await getFromExecutionLayer(`/avax/liquid-staking/position/${req.params.address}`);
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) {
    if (isServiceError(err)) {
      console.warn('[executionLayerProxy] execution layer unreachable, using on-chain fallback for liquid-staking position');
      try {
        const fallback = await getPositionFallback(req.params.address);
        return res.json(fallback);
      } catch (fallbackErr) {
        console.error('[executionLayerProxy] on-chain fallback failed:', fallbackErr.message);
      }
    }
    res.status(500).json({ error: 'Failed to fetch staking position' });
  }
});

/**
 * POST /liquid-staking/prepare-stake
 * Body: { address, amount } — amount in wei
 */
router.post('/liquid-staking/prepare-stake', async (req, res) => {
  try {
    const { address, amount } = req.body;
    const data = await proxyToExecutionLayer('/avax/liquid-staking/prepare-stake', {
      userAddress: address,
      amount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    const steps = data.bundle?.steps ?? [];
    res.json({ status: 200, data: { stake: steps[0] ?? null, bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    if (isServiceError(err)) {
      return res.status(503).json({ status: 503, data: { error: 'Execution layer is unavailable. Please try again later.' } });
    }
    res.status(500).json({ status: 500, data: { error: 'Stake preparation failed' } });
  }
});

/**
 * POST /liquid-staking/prepare-request-unlock
 * Body: { address, sAvaxAmount } — in wei
 */
router.post('/liquid-staking/prepare-request-unlock', async (req, res) => {
  try {
    const { address, sAvaxAmount } = req.body;
    const data = await proxyToExecutionLayer('/avax/liquid-staking/prepare-request-unlock', {
      userAddress: address,
      sAvaxAmount,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    res.json({ status: 200, data: { bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    if (isServiceError(err)) {
      return res.status(503).json({ status: 503, data: { error: 'Execution layer is unavailable. Please try again later.' } });
    }
    res.status(500).json({ status: 500, data: { error: 'Request unlock preparation failed' } });
  }
});

/**
 * POST /liquid-staking/prepare-redeem
 * Body: { address, userUnlockIndex }
 */
router.post('/liquid-staking/prepare-redeem', async (req, res) => {
  try {
    const { address, userUnlockIndex } = req.body;
    const data = await proxyToExecutionLayer('/avax/liquid-staking/prepare-redeem', {
      userAddress: address,
      userUnlockIndex,
    });
    if (data.error) return res.status(400).json({ status: 400, data: { error: data.error } });
    const steps = data.bundle?.steps ?? [];
    res.json({ status: 200, data: { redeem: steps[0] ?? null, bundle: data.bundle, metadata: data.metadata } });
  } catch (err) {
    if (isServiceError(err)) {
      return res.status(503).json({ status: 503, data: { error: 'Execution layer is unavailable. Please try again later.' } });
    }
    res.status(500).json({ status: 500, data: { error: 'Redeem preparation failed' } });
  }
});

module.exports = router;
