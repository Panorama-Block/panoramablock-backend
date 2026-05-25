/**
 * ERC4337DCAAdapter — Automation capability backed by ERC-4337 smart accounts (Thirdweb).
 *
 * SECURITY INVARIANT: session keys are fetched internally for on-chain signing and are
 * NEVER included in any return value. Only on-chain artifacts (addresses, tx hashes) leave
 * this adapter. Violating this invariant would expose custody to the caller.
 *
 * Wraps:
 *   - SmartAccountService (account lifecycle + session key store)
 *   - DCAService          (strategy CRUD + execution history, PostgreSQL)
 *   - TransactionService  (sign-and-execute via session key)
 *   - Execution layer     (DCAVault proxy for Base chain, via HTTP)
 */

import type {
  ProviderMetadata,
  ProviderHealth,
} from '@panorama/capability';
import { CapabilityError } from '@panorama/capability';

import { SmartAccountService } from '../../services/smartAccount.service';
import { DCAService } from '../../services/dca.service';
import { TransactionService } from '../../services/transaction.service';
import { DatabaseService } from '../../services/database.service';

import type {
  IDCAProvider,
  CreateAccountReq,
  CreateAccountResult,
  CreateStrategyReq,
  CreateStrategyResult,
  ExecutionHistoryEntry,
  GetHistoryResult,
  GetStrategiesResult,
  SignAndExecuteReq,
  SmartAccount,
  SupportsRouteParams,
  TransactionResult,
  ValidatePermissionsReq,
  ValidationResult,
  WithdrawReq,
} from '../../domain/ports/dca.provider.port';

// EVM chains supported by Uniswap V3 smart account DCA
const SMART_ACCOUNT_CHAINS = new Set([1, 5, 137, 42161, 10, 8453]);

// Chains where DCAVault (non-custodial, execution layer) is available
const VAULT_CHAINS = new Set([8453]);

// Token decimals for Base chain — used for wei conversion in vault orders
const BASE_TOKEN_DECIMALS: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8,  // cbBTC
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 18, // AERO
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI
};

const INTERVAL_SECONDS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
};

export class ERC4337DCAAdapter implements IDCAProvider {
  readonly name = 'erc4337-dca';

  readonly metadata: ProviderMetadata = {
    name: 'erc4337-dca',
    capability: 'automation',
    supportedChains: [...SMART_ACCOUNT_CHAINS],
    features: ['smart-account', 'session-key', 'dca-vault', 'erc4337'],
    version: '1.0.0',
    enabled: true,
  };

  private readonly smartAccountService: SmartAccountService;
  private readonly dcaService: DCAService;
  private readonly transactionService: TransactionService;
  private readonly executionLayerUrl: string;

  constructor() {
    this.smartAccountService = new SmartAccountService();
    this.dcaService = new DCAService();
    this.transactionService = new TransactionService(this.smartAccountService);
    this.executionLayerUrl = process.env.EXECUTION_LAYER_URL || 'http://localhost:3010';
  }

  // ── Smart account lifecycle ────────────────────────────────────────────────

  async createAccount(req: CreateAccountReq): Promise<CreateAccountResult> {
    try {
      return await this.smartAccountService.createSmartAccount(req);
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to create smart account: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async getAccount(address: string): Promise<SmartAccount | null> {
    try {
      return await this.smartAccountService.getSmartAccount(address);
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to fetch smart account: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async getUserAccounts(userId: string): Promise<SmartAccount[]> {
    try {
      return await this.smartAccountService.getUserAccounts(userId);
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to fetch user accounts: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  // ── Strategy management ────────────────────────────────────────────────────

  async createStrategy(req: CreateStrategyReq): Promise<CreateStrategyResult> {
    try {
      // Base chain → DCAVault (non-custodial, unsigned tx bundle returned to frontend)
      if (VAULT_CHAINS.has(req.fromChainId)) {
        const walletAddress = req.smartAccountId || req.userAddress;
        if (!walletAddress) {
          throw CapabilityError.validation({
            capability: 'automation',
            message: 'userAddress or smartAccountId required for Base DCA vault',
          });
        }
        return await this.proxyVaultCreate({ ...req, userAddress: walletAddress });
      }

      // Other chains → smart account + DB strategy
      if (!req.smartAccountId) {
        throw CapabilityError.validation({
          capability: 'automation',
          message: 'smartAccountId required for non-Base chain DCA',
        });
      }

      const result = await this.dcaService.createStrategy(req as any);
      return { type: 'created', ...result };
    } catch (err) {
      if (CapabilityError.is(err)) throw err;
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to create strategy: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async getStrategies(smartAccountId: string): Promise<GetStrategiesResult> {
    try {
      const account = await this.smartAccountService.getSmartAccount(smartAccountId);
      const [rawStrategies, vaultOrders] = await Promise.all([
        this.dcaService.getAccountStrategies(smartAccountId),
        account ? this.fetchVaultOrders(account.address) : Promise.resolve([]),
      ]);
      // Normalise: legacy DCAStrategy has strategyId?: string; port requires string
      const strategies = rawStrategies.map((s) => ({ ...s, strategyId: s.strategyId ?? '' }));
      return { strategies, vaultOrders };
    } catch (err) {
      if (CapabilityError.is(err)) throw err;
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to fetch strategies: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async toggleStrategy(id: string, active: boolean): Promise<void> {
    try {
      await this.dcaService.toggleStrategy(id, active);
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to toggle strategy: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async deleteStrategy(id: string): Promise<void> {
    try {
      await this.dcaService.deleteStrategy(id);
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to delete strategy: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async getHistory(smartAccountId: string, limit = 100): Promise<GetHistoryResult> {
    try {
      const account = await this.smartAccountService.getSmartAccount(smartAccountId);
      const [history, vaultHistory] = await Promise.all([
        this.dcaService.getExecutionHistory(smartAccountId, limit),
        account ? this.fetchVaultHistory(account.address) : Promise.resolve([]),
      ]);
      return { history, vaultHistory };
    } catch (err) {
      if (CapabilityError.is(err)) throw err;
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Failed to fetch history: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  // ── Transaction execution ──────────────────────────────────────────────────

  async signAndExecute(req: SignAndExecuteReq): Promise<TransactionResult> {
    try {
      const result = await this.transactionService.signAndExecuteTransaction(req);
      if (!result.success) {
        throw new Error(result.error || 'Transaction failed');
      }
      return { transactionHash: result.transactionHash };
    } catch (err) {
      if (CapabilityError.is(err)) throw err;
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `sign-and-execute failed: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  async validatePermissions(req: ValidatePermissionsReq): Promise<ValidationResult> {
    try {
      return await this.transactionService.validateSessionPermissions(
        req.smartAccountAddress,
        req.to,
        req.value,
      );
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Permission validation failed: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  /**
   * Withdraw ERC20 tokens from a smart account to the owner's EOA.
   * SECURITY INVARIANT: session key is retrieved internally and never returned.
   */
  async withdraw(req: WithdrawReq): Promise<TransactionResult> {
    try {
      const { createThirdwebClient, getContract, prepareContractCall, sendTransaction } =
        await import('thirdweb');
      const { defineChain } = await import('thirdweb/chains');
      const { privateKeyToAccount, smartWallet } = await import('thirdweb/wallets');

      const client = createThirdwebClient({ secretKey: process.env.THIRDWEB_SECRET_KEY! });

      // INVARIANT: session key fetched server-side, never returned to caller
      const sessionKeyPrivateKey = await this.smartAccountService.getSessionKey(
        req.smartAccountAddress,
      );
      if (!sessionKeyPrivateKey) {
        throw CapabilityError.validation({
          capability: 'automation',
          message: 'Session key not found or expired for this smart account',
        });
      }

      const personalAccount = privateKeyToAccount({ client, privateKey: sessionKeyPrivateKey });
      const chain = defineChain(req.chainId);
      const wallet = smartWallet({ chain, gasless: false, sponsorGas: false });
      const smartAccount = await wallet.connect({ client, personalAccount });

      const tokenContract = getContract({ client, chain, address: req.tokenAddress });
      const decimals = req.decimals ?? 18;

      // Safe BigInt conversion avoiding floating-point precision loss
      const amountInUnits = toTokenUnits(req.amount, decimals);

      const transaction = prepareContractCall({
        contract: tokenContract,
        method: 'function transfer(address to, uint256 amount) returns (bool)',
        params: [req.userId, amountInUnits],
      });

      const result = await sendTransaction({ transaction, account: smartAccount });
      return { transactionHash: result.transactionHash };
    } catch (err) {
      if (CapabilityError.is(err)) throw err;
      throw CapabilityError.providerFailure({
        capability: 'automation',
        provider: this.name,
        message: `Withdrawal failed: ${asMessage(err)}`,
        cause: err,
      });
    }
  }

  // ── Routing & health ───────────────────────────────────────────────────────

  async supportsRoute(params: SupportsRouteParams): Promise<boolean> {
    // DCAVault handles same-chain Base routes; smart account handles all SMART_ACCOUNT_CHAINS
    if (!SMART_ACCOUNT_CHAINS.has(params.fromChainId)) return false;
    // Cross-chain DCA not supported yet (fromChainId must equal toChainId for smart-account path)
    if (params.toChainId && params.fromChainId !== params.toChainId) return false;
    return true;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const db = DatabaseService.getInstance();
      const ok = await db.checkConnection();
      const latencyMs = Date.now() - start;
      if (!ok) {
        return { healthy: false, latencyMs, reason: 'DB connection failed', checkedAt: new Date().toISOString() };
      }
      return { healthy: true, latencyMs, checkedAt: new Date().toISOString() };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: asMessage(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async proxyVaultCreate(
    req: CreateStrategyReq & { userAddress: string },
  ): Promise<CreateStrategyResult> {
    const intervalSeconds = INTERVAL_SECONDS[req.interval] ?? 86400;
    const amountWei = toTokenUnits(req.amount, BASE_TOKEN_DECIMALS[req.fromToken.toLowerCase()] ?? 18);
    const depositWei = req.depositAmount
      ? toTokenUnits(req.depositAmount, BASE_TOKEN_DECIMALS[req.fromToken.toLowerCase()] ?? 18)
      : amountWei;

    const payload = {
      userAddress: req.userAddress,
      tokenIn: req.fromToken,
      tokenOut: req.toToken,
      amountPerSwap: amountWei.toString(),
      intervalSeconds,
      depositAmount: depositWei.toString(),
    };

    const res = await fetch(`${this.executionLayerUrl}/dca/prepare-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      throw new Error(data.error || `Execution layer error ${res.status}`);
    }

    return {
      type: 'vault_unsigned',
      steps: data.bundle.steps,
      description: data.bundle.summary,
      metadata: data.metadata,
    };
  }

  private async fetchVaultOrders(walletAddress: string): Promise<unknown[]> {
    try {
      const res = await fetch(`${this.executionLayerUrl}/dca/orders/${walletAddress}`);
      if (!res.ok) return [];
      const data = await res.json() as { orders?: unknown[] };
      return data.orders ?? [];
    } catch {
      return [];
    }
  }

  private async fetchVaultHistory(walletAddress: string): Promise<unknown[]> {
    try {
      const res = await fetch(`${this.executionLayerUrl}/dca/history/${walletAddress}`);
      if (!res.ok) return [];
      const data = await res.json() as { transactions?: unknown[] };
      return data.transactions ?? [];
    } catch {
      return [];
    }
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Convert a decimal-string amount to token units (BigInt), avoiding floating-point loss. */
function toTokenUnits(amount: string, decimals: number): bigint {
  const [intPart = '0', fracPart = ''] = amount.split('.');
  const fracPadded = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '<unknown error>';
}
