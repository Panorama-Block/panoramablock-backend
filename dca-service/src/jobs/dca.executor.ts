import cron from 'node-cron';
import { DCAService } from '../services/dca.service';
import { SmartAccountService } from '../services/smartAccount.service';
import { SwapService } from '../services/swap.service';
import { AuditLogger, AuditEventType } from '../services/auditLog.service';
import { DCAStrategy } from '../types';

const EXECUTION_LAYER_URL = process.env.EXECUTION_LAYER_URL || 'http://localhost:3010';

function toWei(amount: string, decimals: number): string {
  const [intPart, fracPart = ''] = amount.split('.');
  const fracPadded = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return (BigInt(intPart) * BigInt(10 ** decimals) + BigInt(fracPadded || '0')).toString();
}

/**
 * DCA Executor - Runs strategies on schedule
 * This job checks for pending DCA executions every minute.
 * Supports all actionTypes: swap, lending, liquid_staking, liquidity_pool.
 */
export class DCAExecutor {
  private dcaService: DCAService;
  private smartAccountService: SmartAccountService;
  private swapService: SwapService;
  private auditLogger: AuditLogger;
  private job: cron.ScheduledTask | null = null;

  constructor() {
    this.dcaService = new DCAService();
    this.smartAccountService = new SmartAccountService();
    this.swapService = new SwapService();
    this.auditLogger = AuditLogger.getInstance();
  }

  start() {
    console.log('[DCA Executor] Starting DCA execution cron job...');
    this.job = cron.schedule('* * * * *', async () => {
      await this.executeReadyStrategies();
    });
    console.log('[DCA Executor] ✅ Cron job started (runs every minute)');
  }

  stop() {
    if (this.job) {
      this.job.stop();
      console.log('[DCA Executor] Cron job stopped');
    }
  }

  private async executeReadyStrategies() {
    try {
      console.log('[DCA Executor] Checking for pending executions...');
      const strategyIds = await this.dcaService.getReadyStrategies();

      if (strategyIds.length === 0) {
        console.log('[DCA Executor] No strategies ready for execution');
        return;
      }

      console.log(`[DCA Executor] Found ${strategyIds.length} strategies to execute`);

      for (const strategyId of strategyIds) {
        try {
          await this.executeStrategy(strategyId);
        } catch (error: any) {
          console.error(`[DCA Executor] ❌ Error executing strategy ${strategyId}:`, error.message);
          const strategy = await this.dcaService.getStrategy(strategyId);
          if (strategy) {
            await this.dcaService.addExecutionHistory(strategy.smartAccountId, {
              timestamp: Date.now(),
              txHash: '',
              amount: strategy.amount,
              fromToken: strategy.fromToken,
              toToken: strategy.toToken,
              status: 'failed',
              error: error.message
            });
          }
        }
      }
    } catch (error) {
      console.error('[DCA Executor] Error in executeReadyStrategies:', error);
    }
  }

  private async executeStrategy(strategyId: string) {
    const strategy = await this.dcaService.getStrategy(strategyId);
    if (!strategy || !strategy.isActive) {
      console.log(`[DCA Executor] Strategy ${strategyId} not found or inactive`);
      return;
    }

    const actionType = strategy.actionType || 'swap';
    console.log(`[DCA Executor] Executing ${actionType} strategy ${strategyId}...`);

    const sessionKey = await this.smartAccountService.getSessionKey(strategy.smartAccountId);
    if (!sessionKey) {
      console.log(`[DCA Executor] Session key expired for ${strategy.smartAccountId}`);
      await this.dcaService.toggleStrategy(strategyId, false);
      await this.dcaService.addExecutionHistory(strategy.smartAccountId, {
        timestamp: Date.now(), txHash: '', amount: strategy.amount,
        fromToken: strategy.fromToken, toToken: strategy.toToken,
        status: 'failed', error: 'Session key expired'
      });
      return;
    }

    const account = await this.smartAccountService.getSmartAccount(strategy.smartAccountId);
    const userId = account?.userId || strategy.smartAccountId;

    await this.auditLogger.log({
      eventType: AuditEventType.STRATEGY_UPDATED,
      userId,
      metadata: { strategyId, smartAccountId: strategy.smartAccountId, actionType, action: 'execution_started' },
    });

    let txHash: string;

    switch (actionType) {
      case 'swap':
        txHash = await this.executeSwapStrategy(strategy, sessionKey, userId);
        break;
      case 'lending':
        txHash = await this.executeLendingStrategy(strategy, sessionKey, userId);
        break;
      case 'liquid_staking':
        txHash = await this.executeStakingStrategy(strategy, sessionKey, userId);
        break;
      case 'liquidity_pool':
        txHash = await this.executeLPStrategy(strategy, sessionKey, userId);
        break;
      default:
        throw new Error(`Unknown actionType: ${actionType}`);
    }

    await this.dcaService.addExecutionHistory(strategy.smartAccountId, {
      timestamp: Date.now(), txHash, amount: strategy.amount,
      fromToken: strategy.fromToken, toToken: strategy.toToken, status: 'success'
    });

    await this.dcaService.updateStrategyAfterExecution(strategyId);
    console.log(`[DCA Executor] ✅ ${actionType} strategy ${strategyId} executed. TX: ${txHash}`);

    await this.auditLogger.log({
      eventType: AuditEventType.SWAP_SUCCESS,
      userId,
      metadata: { strategyId, actionType, txHash },
    });
  }

  // ── Swap (existing logic) ─────────────────────────────────────────────
  private async executeSwapStrategy(strategy: DCAStrategy, sessionKey: string, userId: string): Promise<string> {
    const result = await this.swapService.executeSwap({
      smartAccountAddress: strategy.smartAccountId,
      sessionKey,
      fromToken: strategy.fromToken,
      toToken: strategy.toToken,
      fromChainId: strategy.fromChainId,
      toChainId: strategy.toChainId,
      amount: strategy.amount,
      userId,
    });
    return result.txHash;
  }

  // ── Lending ────────────────────────────────────────────────────────────
  private async executeLendingStrategy(strategy: DCAStrategy, sessionKey: string, userId: string): Promise<string> {
    const action = strategy.lendingAction || 'supply';
    const protocol = strategy.protocol || 'benqi';
    console.log(`[DCA Executor] 🏦 Executing lending strategy: ${action} ${strategy.amount} on ${protocol}`);

    if (protocol === 'benqi' || strategy.fromChainId === 43114) {
      const path = action === 'borrow' ? '/avax/lending/prepare-borrow' : '/avax/lending/prepare-supply';
      const amountWei = toWei(strategy.amount, 18);
      return this.proxyToExecutionLayer(path, {
        userAddress: strategy.smartAccountId.toLowerCase(),
        qTokenAddress: strategy.fromToken.toLowerCase(),
        amount: amountWei,
      }, strategy, sessionKey);
    }

    throw new Error(`Lending protocol "${protocol}" on chain ${strategy.fromChainId} is not yet supported by the execution layer. Supported: Benqi (Avalanche).`);
  }

  // ── Liquid Staking ─────────────────────────────────────────────────────
  private async executeStakingStrategy(strategy: DCAStrategy, sessionKey: string, userId: string): Promise<string> {
    console.log(`[DCA Executor] 💧 Executing staking strategy: stake ${strategy.amount}`);

    if (strategy.fromChainId === 43114) {
      // Avalanche: AVAX → sAVAX via Benqi
      const amountWei = toWei(strategy.amount, 18);
      return this.proxyToExecutionLayer('/avax/liquid-staking/prepare-stake', {
        userAddress: strategy.smartAccountId.toLowerCase(),
        amount: amountWei,
      }, strategy, sessionKey);
    }

    throw new Error(`Liquid staking not yet supported on chain ${strategy.fromChainId}`);
  }

  // ── Liquidity Pool ─────────────────────────────────────────────────────
  private async executeLPStrategy(strategy: DCAStrategy, sessionKey: string, userId: string): Promise<string> {
    console.log(`[DCA Executor] 🔀 Executing LP strategy: add liquidity ${strategy.amount} + ${strategy.amountB}`);

    return this.proxyToExecutionLayer('/dca/prepare-dca-lp', {
      userAddress: strategy.smartAccountId.toLowerCase(),
      poolId: `${strategy.fromToken}-${strategy.toToken}`,
      amountA: strategy.amount,
      amountB: strategy.amountB || '0',
      slippageBps: 100,
    }, strategy, sessionKey);
  }

  /**
   * Proxy to execution-layer to get a bundle, then sign & submit all steps
   * using the smart account session key.
   */
  private async proxyToExecutionLayer(
    path: string,
    payload: Record<string, unknown>,
    strategy: DCAStrategy,
    sessionKey: string,
  ): Promise<string> {
    // 1. Get unsigned bundle from execution-layer
    const res = await fetch(`${EXECUTION_LAYER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Execution layer error (${res.status}): ${err}`);
    }

    const data = await res.json() as { bundle: { steps: Array<{ to: string; data: string; value: string }> } };
    const steps = data.bundle?.steps;
    if (!steps || steps.length === 0) {
      throw new Error('Execution layer returned empty bundle');
    }

    // 2. Sign and submit each step via smart account
    const { createThirdwebClient, defineChain, prepareTransaction, sendAndConfirmTransaction } = await import('thirdweb');
    const { privateKeyToAccount } = await import('thirdweb/wallets');
    const { smartWallet } = await import('thirdweb/wallets');

    const client = createThirdwebClient({ secretKey: process.env.THIRDWEB_SECRET_KEY! });
    const chain = defineChain(strategy.fromChainId);
    const personalAccount = privateKeyToAccount({ client, privateKey: sessionKey });
    const wallet = smartWallet({ chain, gasless: false });
    const smartAccount = await wallet.connect({ client, personalAccount });

    let lastTxHash = '';
    for (const step of steps) {
      const tx = prepareTransaction({
        client,
        chain,
        to: step.to as `0x${string}`,
        data: step.data as `0x${string}`,
        value: BigInt(step.value || '0'),
      });
      const receipt = await sendAndConfirmTransaction({ transaction: tx, account: smartAccount });
      lastTxHash = receipt.transactionHash;
    }

    return lastTxHash;
  }
}

/**
 * Initialize and start DCA executor
 */
export function startDCAExecutor(): DCAExecutor {
  const executor = new DCAExecutor();
  executor.start();
  return executor;
}
