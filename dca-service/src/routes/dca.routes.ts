import { Router, Response } from 'express';
import { SmartAccountService } from '../services/smartAccount.service';
import { DCAService } from '../services/dca.service';
import { QuoteService } from '../services/quote.service';
import { CreateSmartAccountRequest, CreateStrategyRequest } from '../types';
import { AuthenticatedRequest, verifyTelegramAuth, requireOwnership, devBypassAuth } from '../middleware/auth.middleware';

const EXECUTION_LAYER_URL = process.env.EXECUTION_LAYER_URL || 'http://localhost:3010';

const INTERVAL_SECONDS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
};

async function fetchVaultOrders(walletAddress: string): Promise<unknown[]> {
  try {
    const res = await fetch(`${EXECUTION_LAYER_URL}/dca/orders/${walletAddress}`);
    if (!res.ok) return [];
    const data = await res.json() as { orders?: unknown[] };
    return data.orders ?? [];
  } catch {
    return [];
  }
}

async function fetchVaultHistory(walletAddress: string): Promise<unknown[]> {
  try {
    const res = await fetch(`${EXECUTION_LAYER_URL}/dca/history/${walletAddress}`);
    if (!res.ok) return [];
    const data = await res.json() as { transactions?: unknown[] };
    return data.transactions ?? [];
  } catch {
    return [];
  }
}

// Token decimals for Base chain tokens (execution layer expects amounts in wei)
const BASE_TOKEN_DECIMALS: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8,  // cbBTC
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 18, // AERO
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI (Base)
};

function toTokenWei(amount: string, tokenAddress: string): string {
  const decimals = BASE_TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  // Use BigInt math to avoid floating point issues
  const [intPart, fracPart = ''] = amount.split('.');
  const fracPadded = fracPart.padEnd(decimals, '0').slice(0, decimals);
  const raw = BigInt(intPart) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
  return raw.toString();
}

async function proxyVaultCreate(body: CreateStrategyRequest & { userAddress?: string; depositAmount?: string }): Promise<unknown> {
  const intervalSeconds = INTERVAL_SECONDS[body.interval] ?? 86400;
  const amountWei = toTokenWei(body.amount, body.fromToken);
  const depositWei = body.depositAmount
    ? toTokenWei(body.depositAmount, body.fromToken)
    : amountWei;
  const payload = {
    userAddress: body.userAddress || body.smartAccountId,
    tokenIn: body.fromToken,
    tokenOut: body.toToken,
    amountPerSwap: amountWei,
    intervalSeconds,
    depositAmount: depositWei,
  };
  const res = await fetch(`${EXECUTION_LAYER_URL}/dca/prepare-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).error || `Execution layer error ${res.status}`);
  return data;
}
import {
  createAccountLimiter,
  createStrategyLimiter,
  readLimiter,
  debugLimiter,
  generalLimiter
} from '../middleware/rateLimit.middleware';
import { WETH_ADDRESS, SWAP_DEADLINE_SECONDS, MAX_SLIPPAGE_PERCENT } from '../config/swap.config';

export function dcaRoutes() {
  const router = Router();
  const smartAccountService = new SmartAccountService();
  const dcaService = new DCAService();

  // ==================== SMART ACCOUNTS ====================

  /**
   * POST /dca/create-account
   * Create a new smart account with session keys
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.post('/create-account',
    createAccountLimiter, // Rate limit: 5 per hour
    devBypassAuth, // Allow dev bypass in development
    verifyTelegramAuth, // Validate Telegram initData
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log('[POST /create-account] Request received');

      const request: CreateSmartAccountRequest = req.body;

      if (!request.userId || !request.name || !request.permissions) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // 🔒 SECURITY: Verify user can only create accounts for themselves
      if (req.user && req.user.id !== request.userId) {
        console.warn(`[POST /create-account] User ${req.user.id} tried to create account for ${request.userId}`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only create accounts for yourself'
        });
      }

      const result = await smartAccountService.createSmartAccount(request);

      console.log('[POST /create-account] ✅ Account created successfully');
      res.json(result);
    } catch (error: any) {
      console.error('[POST /create-account] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /dca/accounts/:userId
   * Get all smart accounts for a user
   * 🔒 PROTECTED: Requires Telegram authentication + ownership
   */
  router.get('/accounts/:userId',
    readLimiter, // Rate limit: 200 per 15min
    devBypassAuth,
    verifyTelegramAuth,
    requireOwnership('userId'), // Ensure user can only access their own accounts
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log('[GET /accounts/:userId] Request for user:', req.params.userId);

      const accounts = await smartAccountService.getUserAccounts(req.params.userId);

      // Log para debug
      console.log('[GET /accounts/:userId] Returning accounts:', JSON.stringify(accounts, null, 2));

      res.json({ accounts });
    } catch (error: any) {
      console.error('[GET /accounts/:userId] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /dca/account/:address
   * Get single smart account details
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.get('/account/:address',
    readLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      const account = await smartAccountService.getSmartAccount(req.params.address);

      if (!account) {
        return res.status(404).json({ error: 'Account not found' });
      }

      // 🔒 SECURITY: Verify ownership
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[GET /account/:address] User ${req.user.id} tried to access ${account.userId}'s account`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only access your own accounts'
        });
      }

      res.json(account);
    } catch (error: any) {
      console.error('[GET /account/:address] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /dca/account/:address
   * Delete a smart account
   * 🔒 PROTECTED: Requires Telegram authentication + ownership
   */
  router.delete('/account/:address',
    generalLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log('[DELETE /account/:address] Deleting account:', req.params.address);

      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      // 🔒 SECURITY: Verify ownership
      if (req.user && req.user.id !== userId) {
        console.warn(`[DELETE /account/:address] User ${req.user.id} tried to delete ${userId}'s account`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only delete your own accounts'
        });
      }

      await smartAccountService.deleteSmartAccount(req.params.address, userId);

      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /account/:address] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DCA STRATEGIES ====================

  /**
   * POST /dca/create-strategy
   * Create a new DCA strategy.
   * - fromChainId === 8453 (Base): proxies to DCAVault on execution-layer,
   *   returns { type: 'vault_unsigned', steps, description } — user must sign.
   * - Other chains: creates strategy via smart account, returns { type: 'created', strategyId, nextExecution }.
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.post('/create-strategy',
    createStrategyLimiter, // Rate limit: 10 per 15min
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log('[POST /create-strategy] Request received, body:', JSON.stringify(req.body));

      const request: CreateStrategyRequest & { userAddress?: string; depositAmount?: string } = req.body;

      if (!request.fromToken || !request.toToken || !request.amount || !request.interval) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // ── Base chain → DCAVault (non-custodial, returns unsigned bundle) ─────
      if (request.fromChainId === 8453) {
        console.log('[POST /create-strategy] Base chain detected, routing to DCAVault');
        // Use the selected smart wallet as the vault order owner so the keeper
        // executes on behalf of that address (not the raw EOA).
        const walletAddress = request.smartAccountId || req.user?.id || request.userAddress;
        if (!walletAddress) {
          return res.status(400).json({ error: 'Could not determine wallet address for Base DCA' });
        }
        console.log('[POST /create-strategy] vault userAddress:', walletAddress);
        const vaultResult = await proxyVaultCreate({ ...request, userAddress: walletAddress }) as {
          bundle: { steps: unknown[]; totalSteps: number; summary: string };
          metadata: unknown;
        };
        return res.json({
          type: 'vault_unsigned',
          steps: vaultResult.bundle.steps,
          description: vaultResult.bundle.summary,
          metadata: vaultResult.metadata,
        });
      }

      // ── Other chains → smart account flow ─────────────────────────────────
      if (!request.smartAccountId) {
        return res.status(400).json({ error: 'smartAccountId required for non-Base chains' });
      }

      // 🔒 SECURITY: Verify user owns the smart account
      const account = await smartAccountService.getSmartAccount(request.smartAccountId);
      if (!account) {
        return res.status(404).json({ error: 'Smart account not found' });
      }
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[POST /create-strategy] User ${req.user.id} tried to create strategy for ${account.userId}'s account`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only create strategies for your own accounts'
        });
      }

      const result = await dcaService.createStrategy(request);

      console.log('[POST /create-strategy] ✅ Strategy created successfully');
      return res.json({ type: 'created', ...result });
    } catch (error: any) {
      console.error('[POST /create-strategy] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /dca/strategies/:smartAccountId
   * Get all strategies for a smart account
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.get('/strategies/:smartAccountId',
    readLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🔒 SECURITY: Verify ownership
      const account = await smartAccountService.getSmartAccount(req.params.smartAccountId);
      if (!account) {
        return res.status(404).json({ error: 'Smart account not found' });
      }
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[GET /strategies/:smartAccountId] User ${req.user.id} tried to access ${account.userId}'s strategies`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only access your own strategies'
        });
      }

      const strategies = await dcaService.getAccountStrategies(req.params.smartAccountId);

      // Also fetch Base DCAVault orders for the smart account owner
      const vaultOrders = await fetchVaultOrders(account.address);

      res.json({ strategies, vaultOrders });
    } catch (error: any) {
      console.error('[GET /strategies/:smartAccountId] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /dca/strategy/:strategyId/toggle
   * Activate or deactivate a strategy
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.patch('/strategy/:strategyId/toggle',
    generalLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }

      // 🔒 SECURITY: Verify ownership
      const strategy = await dcaService.getStrategy(req.params.strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }
      const account = await smartAccountService.getSmartAccount(strategy.smartAccountId);
      if (!account) {
        return res.status(404).json({ error: 'Smart account not found' });
      }
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[PATCH /strategy/:strategyId/toggle] User ${req.user.id} tried to toggle ${account.userId}'s strategy`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only modify your own strategies'
        });
      }

      await dcaService.toggleStrategy(req.params.strategyId, isActive);

      res.json({ success: true, isActive });
    } catch (error: any) {
      console.error('[PATCH /strategy/:strategyId/toggle] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /dca/strategy/:strategyId
   * Delete a strategy
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.delete('/strategy/:strategyId',
    generalLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🔒 SECURITY: Verify ownership
      const strategy = await dcaService.getStrategy(req.params.strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }
      const account = await smartAccountService.getSmartAccount(strategy.smartAccountId);
      if (!account) {
        return res.status(404).json({ error: 'Smart account not found' });
      }
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[DELETE /strategy/:strategyId] User ${req.user.id} tried to delete ${account.userId}'s strategy`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only delete your own strategies'
        });
      }

      await dcaService.deleteStrategy(req.params.strategyId);

      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /strategy/:strategyId] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /dca/history/:smartAccountId
   * Get execution history for a smart account
   * 🔒 PROTECTED: Requires Telegram authentication
   */
  router.get('/history/:smartAccountId',
    readLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🔒 SECURITY: Verify ownership
      const account = await smartAccountService.getSmartAccount(req.params.smartAccountId);
      if (!account) {
        return res.status(404).json({ error: 'Smart account not found' });
      }
      if (req.user && req.user.id !== account.userId) {
        console.warn(`[GET /history/:smartAccountId] User ${req.user.id} tried to access ${account.userId}'s history`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only access your own history'
        });
      }

      const limit = parseInt(req.query.limit as string) || 100;
      const [history, vaultHistory] = await Promise.all([
        dcaService.getExecutionHistory(req.params.smartAccountId, limit),
        fetchVaultHistory(account.address),
      ]);

      res.json({ history, vaultHistory });
    } catch (error: any) {
      console.error('[GET /history/:smartAccountId] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DEBUG/ADMIN ROUTES ====================

  // TODO: Reimplementar rotas de debug com PostgreSQL
  // Ver TODO_DEBUG_ROUTES.md para lista completa de rotas removidas temporariamente
  // As seguintes rotas foram removidas pois usavam Redis diretamente:
  // - GET /dca/debug/all-accounts, GET /dca/debug/all-strategies, etc.

  /**
   * POST /dca/debug/execute/:strategyId
   * Manually execute a DCA strategy (for testing)
   * 🔒 DEBUG: Rate limited, disable in production
   */
  router.post('/debug/execute/:strategyId',
    debugLimiter,
    devBypassAuth,
    verifyTelegramAuth,
    async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      console.log(`\n[POST /debug/execute] 🚀 Manually executing strategy: ${strategyId}`);

      // 1. Get strategy data
      const strategy = await dcaService.getStrategy(strategyId);

      if (!strategy) {
        return res.status(404).json({
          error: 'Strategy not found',
          strategyId
        });
      }

      // 2. Check if strategy is active
      if (!strategy.isActive) {
        return res.status(400).json({
          error: 'Strategy is inactive',
          strategyId,
          status: strategy.isActive
        });
      }

      const {
        smartAccountId,
        fromToken,
        toToken,
        fromChainId,
        toChainId,
        amount,
        interval
      } = strategy;

      console.log(`[POST /debug/execute] Strategy details:`, {
        smartAccountId,
        fromToken,
        toToken,
        fromChainId,
        toChainId,
        amount,
        interval
      });

      // 3. Get encrypted session key
      const sessionKey = await smartAccountService.getSessionKey(smartAccountId);

      if (!sessionKey) {
        console.log(`[POST /debug/execute] ❌ Session key expired for ${smartAccountId}`);

        // Mark strategy as inactive
        await dcaService.toggleStrategy(strategyId, false);

        // Log failure
        await dcaService.addExecutionHistory(smartAccountId, {
          timestamp: Date.now(),
          txHash: '',
          amount,
          fromToken,
          toToken,
          status: 'failed',
          error: 'Session key expired'
        });

        return res.status(400).json({
          error: 'Session key expired',
          message: 'Strategy has been deactivated',
          strategyId
        });
      }

      console.log(`[POST /debug/execute] ✅ Session key found for ${smartAccountId}`);

      // 4. Execute swap via liquid-swap-service or thirdweb engine
      console.log(`[POST /debug/execute] 🔄 Executing swap...`);

      const swapResult = await executeSwap({
        smartAccountAddress: smartAccountId,
        sessionKey,
        fromToken,
        toToken,
        fromChainId,
        toChainId,
        amount
      });

      console.log(`[POST /debug/execute] ✅ Swap executed successfully. TX: ${swapResult.txHash}`);

      // 5. Log execution in history
      await dcaService.addExecutionHistory(smartAccountId, {
        timestamp: Date.now(),
        txHash: swapResult.txHash,
        amount,
        fromToken,
        toToken,
        status: 'success'
      });

      // 6. Update strategy for next execution
      await dcaService.updateStrategyAfterExecution(strategyId);

      // 7. Get updated strategy data
      const updatedStrategy = await dcaService.getStrategy(strategyId);

      res.json({
        success: true,
        message: 'Strategy executed successfully',
        execution: {
          strategyId,
          txHash: swapResult.txHash,
          timestamp: Date.now(),
          amount,
          fromToken,
          toToken,
          fromChainId,
          toChainId,
        },
        nextExecution: {
          timestamp: updatedStrategy?.nextExecution || 0,
          date: updatedStrategy ? new Date(updatedStrategy.nextExecution * 1000).toISOString() : 'N/A',
        }
      });
    } catch (error: any) {
      console.error('[POST /debug/execute] ❌ Error:', error);
      res.status(500).json({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  /**
   * Execute swap using Thirdweb SDK directly
   */
  async function executeSwap(params: {
    smartAccountAddress: string;
    sessionKey: string;
    fromToken: string;
    toToken: string;
    fromChainId: number;
    toChainId: number;
    amount: string;
  }): Promise<{ txHash: string }> {
    console.log('[executeSwap] 🔄 Preparing swap transaction...');
    console.log('[executeSwap] From:', params.fromToken);
    console.log('[executeSwap] To:', params.toToken);
    console.log('[executeSwap] Amount:', params.amount);
    console.log('[executeSwap] Chain:', params.fromChainId);

    try {
      // Import Thirdweb functions
      const { createThirdwebClient, getContract } = await import('thirdweb');
      const { defineChain } = await import('thirdweb/chains');
      const { privateKeyToAccount, smartWallet } = await import('thirdweb/wallets');
      const { prepareContractCall, sendTransaction, toWei } = await import('thirdweb');
      const { approve, allowance: getAllowance } = await import('thirdweb/extensions/erc20');

      // 1. Initialize Thirdweb client
      const client = createThirdwebClient({
        secretKey: process.env.THIRDWEB_SECRET_KEY!,
      });

      const chain = defineChain(params.fromChainId);

      console.log('[executeSwap] ✅ Thirdweb client initialized');

      // 2. Create personal account from session key
      const personalAccount = privateKeyToAccount({
        client,
        privateKey: params.sessionKey,
      });

      // 3. Connect to smart wallet
      // Smart Account will pay gas from its own balance
      const wallet = smartWallet({
        chain,
        gasless: false, // Smart Account pays gas from its own ETH balance
        sponsorGas: false, // Disable Thirdweb paymaster (Smart Account pays directly!)
        // Using Thirdweb's default bundler (included with secretKey)
        // No custom bundler override needed
      });

      const smartAccount = await wallet.connect({
        client,
        personalAccount,
      });

      console.log('[executeSwap] ✅ Connected to smart account:', smartAccount.address);
      console.log('[executeSwap] 💰 Smart wallet will pay gas from its own balance');

      // 4. Check if we need to swap native ETH or ERC20 token
      const isNativeToken = params.fromToken === '0x0000000000000000000000000000000000000000' ||
                           params.fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

      if (isNativeToken) {
        // Native ETH swap - use Uniswap Router directly
        console.log('[executeSwap] 💎 Swapping native ETH');

        // Uniswap V3 SwapRouter address on Ethereum mainnet
        const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

        const swapRouterContract = getContract({
          client,
          chain,
          address: SWAP_ROUTER_ADDRESS,
        });

        const amountInWei = toWei(params.amount);
        const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;

        // 🔒 SECURITY: Get quote with slippage protection
        console.log('[executeSwap] 🔍 Getting price quote with slippage protection...');
        const quoteService = new QuoteService();
        const quote = await quoteService.getQuote({
          fromToken: WETH_ADDRESS,
          toToken: params.toToken,
          amountIn: BigInt(amountInWei),
          chainId: params.fromChainId,
          slippagePercent: MAX_SLIPPAGE_PERCENT,
        });

        console.log('[executeSwap] 💰 Quote:', {
          expectedOutput: quote.amountOut.toString(),
          minimumOutput: quote.amountOutMinimum.toString(),
          priceImpact: `${quote.priceImpact.toFixed(2)}%`,
          slippage: `${MAX_SLIPPAGE_PERCENT}%`,
        });

        // Warn if price impact is too high
        if (quote.priceImpact > 5.0) {
          console.warn(`[executeSwap] ⚠️ High price impact: ${quote.priceImpact.toFixed(2)}%`);
        }

        // exactInputSingle parameters
        const swapParams = {
          tokenIn: WETH_ADDRESS, // ✅ Use WETH instead of 0x00...00 for Uniswap V3
          tokenOut: params.toToken,
          fee: 3000, // 0.3% fee tier
          recipient: smartAccount.address,
          deadline: BigInt(deadline),
          amountIn: BigInt(amountInWei),
          amountOutMinimum: quote.amountOutMinimum, // ✅ SECURITY: Slippage protection enabled
          sqrtPriceLimitX96: BigInt(0),
        };

        console.log('[executeSwap] 📋 Swap params:', {
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          fee: swapParams.fee,
          recipient: swapParams.recipient,
          deadline: swapParams.deadline.toString(),
          amountIn: swapParams.amountIn.toString(),
          amountInEth: params.amount,
          amountOutMinimum: swapParams.amountOutMinimum.toString(),
          value: amountInWei.toString(),
        });

        const transaction = prepareContractCall({
          contract: swapRouterContract,
          method: 'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)',
          params: [swapParams],
          value: BigInt(amountInWei),
        });

        console.log('[executeSwap] 📝 Swap transaction prepared');

        // Execute the swap
        const result = await sendTransaction({
          transaction,
          account: smartAccount,
        });

        console.log('[executeSwap] ✅ Swap executed successfully!');
        console.log('[executeSwap] TX Hash:', result.transactionHash);

        return {
          txHash: result.transactionHash,
        };

      } else {
        // ERC20 token swap
        console.log('[executeSwap] 🪙 Swapping ERC20 token');

        const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

        // First check and approve if needed
        const tokenContract = getContract({
          client,
          chain,
          address: params.fromToken,
        });

        const allowance = await getAllowance({
          contract: tokenContract,
          owner: smartAccount.address,
          spender: SWAP_ROUTER_ADDRESS,
        });

        const amountInWei = BigInt(toWei(params.amount));

        if (allowance < amountInWei) {
          console.log('[executeSwap] 📝 Approving token spend...');

          const approveTransaction = approve({
            contract: tokenContract,
            spender: SWAP_ROUTER_ADDRESS,
            amountWei: amountInWei,
          });

          await sendTransaction({
            transaction: approveTransaction,
            account: smartAccount,
          });

          console.log('[executeSwap] ✅ Token approved');
        }

        // Now execute the swap
        const swapRouterContract = getContract({
          client,
          chain,
          address: SWAP_ROUTER_ADDRESS,
        });

        const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;

        // 🔒 SECURITY: Get quote with slippage protection
        console.log('[executeSwap] 🔍 Getting price quote with slippage protection...');
        const quoteService = new QuoteService();
        const quote = await quoteService.getQuote({
          fromToken: params.fromToken,
          toToken: params.toToken,
          amountIn: amountInWei,
          chainId: params.fromChainId,
          slippagePercent: MAX_SLIPPAGE_PERCENT,
        });

        console.log('[executeSwap] 💰 Quote:', {
          expectedOutput: quote.amountOut.toString(),
          minimumOutput: quote.amountOutMinimum.toString(),
          priceImpact: `${quote.priceImpact.toFixed(2)}%`,
          slippage: `${MAX_SLIPPAGE_PERCENT}%`,
        });

        // Warn if price impact is too high
        if (quote.priceImpact > 5.0) {
          console.warn(`[executeSwap] ⚠️ High price impact: ${quote.priceImpact.toFixed(2)}%`);
        }

        const swapParams = {
          tokenIn: params.fromToken,
          tokenOut: params.toToken,
          fee: 3000,
          recipient: smartAccount.address,
          deadline: BigInt(deadline),
          amountIn: amountInWei,
          amountOutMinimum: quote.amountOutMinimum, // ✅ SECURITY: Slippage protection enabled
          sqrtPriceLimitX96: BigInt(0),
        };

        const transaction = prepareContractCall({
          contract: swapRouterContract,
          method: 'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) returns (uint256)',
          params: [swapParams],
        });

        console.log('[executeSwap] 📝 Swap transaction prepared');

        const result = await sendTransaction({
          transaction,
          account: smartAccount,
        });

        console.log('[executeSwap] ✅ Swap executed successfully!');
        console.log('[executeSwap] TX Hash:', result.transactionHash);

        return {
          txHash: result.transactionHash,
        };
      }
    } catch (error: any) {
      console.error('[executeSwap] ❌ Swap failed:', error);
      throw new Error(`Swap execution failed: ${error.message}`);
    }
  }

  return router;
}
