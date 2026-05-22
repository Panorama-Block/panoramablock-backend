/**
 * LidoProviderAdapter — wraps the existing `LidoService` behind the `IStakingProvider` port.
 *
 * The legacy `LidoService` retains its own callers (the deprecated `/api/lido/*` routes) — this
 * adapter is a façade that lets the new `/v1/capability/staking/*` namespace consume the same
 * underlying logic without forcing a full rewrite of the service in this PR.
 *
 * Card #247 (SPRINT_HUGO.md).
 */

import {
  CapabilityError,
  ErrorCategory,
  type Address,
  type ChainId,
  type ProviderMetadata,
  type Transaction,
} from '@panorama/capability';
import { getChain } from '@panorama/capability/chains';

import {
  type CapabilityStakingPosition,
  type IStakingProvider,
  type PrepareClaimInput,
  type PrepareStakeInput,
  type PrepareUnstakeInput,
  type StakingRouteParams,
} from '../../domain/ports/staking.provider.port';
import { LidoService } from '../../application/services/LidoService';
import { Logger } from '../logs/logger';

const ETHEREUM_CHAIN_ID = getChain('ethereum').id;

export interface LidoProviderAdapterDeps {
  lidoService: LidoService;
  logger?: Logger;
}

export class LidoProviderAdapter implements IStakingProvider {
  public readonly name = 'lido';
  public readonly metadata: ProviderMetadata = {
    name: 'lido',
    capability: 'staking',
    supportedChains: [ETHEREUM_CHAIN_ID],
    features: ['stETH', 'wstETH', 'withdrawal-queue'],
    version: '1.0.0',
    enabled: true,
  };

  private readonly lidoService: LidoService;
  private readonly logger?: Logger;

  constructor(deps: LidoProviderAdapterDeps) {
    this.lidoService = deps.lidoService;
    this.logger = deps.logger;
  }

  // -----------------------------------------------------------------------------------------------
  // ICapabilityProvider
  // -----------------------------------------------------------------------------------------------

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; reason?: string; checkedAt: string }> {
    const start = Date.now();
    try {
      // Cheapest available probe — fetch protocol info (cached upstream).
      await this.lidoService.getProtocolInfo();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: (e as Error).message,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // -----------------------------------------------------------------------------------------------
  // IStakingProvider
  // -----------------------------------------------------------------------------------------------

  async supportsRoute(params: StakingRouteParams): Promise<boolean> {
    if (params.chainId !== ETHEREUM_CHAIN_ID) return false;
    if (params.asset && params.asset.toUpperCase() !== 'ETH') return false;
    return true;
  }

  async getPosition(
    userAddress: Address,
    chainId: ChainId,
  ): Promise<CapabilityStakingPosition | null> {
    this.ensureChain(chainId, 'getPosition');
    const pos = await this.lidoService.getStakingPosition(userAddress);
    if (!pos) return null;
    return {
      stakedAmountWei: pos.stakedAmount,
      receiptTokenBalanceWei: pos.stETHBalance ?? '0',
      receiptTokenSymbol: 'stETH',
      apr: pos.apy,
      extra: {
        wstETHBalanceWei: pos.wstETHBalance ?? '0',
        status: pos.status,
      },
    };
  }

  async prepareStake(input: PrepareStakeInput): Promise<Transaction[]> {
    this.ensureChain(input.chainId, 'prepareStake');
    try {
      const tx = await this.lidoService.stake(input.userAddress, input.amount);
      return this.unwrapTransactions(tx.transactionData, input.chainId, 'stake');
    } catch (e) {
      throw this.toCapabilityError(e, 'prepareStake');
    }
  }

  async prepareUnstake(input: PrepareUnstakeInput): Promise<Transaction[]> {
    this.ensureChain(input.chainId, 'prepareUnstake');
    try {
      const tx = await this.lidoService.unstake(input.userAddress, input.amount);
      return this.unwrapTransactions(tx.transactionData, input.chainId, 'unstake');
    } catch (e) {
      throw this.toCapabilityError(e, 'prepareUnstake');
    }
  }

  async prepareClaim(input: PrepareClaimInput): Promise<Transaction[]> {
    this.ensureChain(input.chainId, 'prepareClaim');
    if (!input.requestIds || input.requestIds.length === 0) {
      throw CapabilityError.validation({
        capability: 'staking',
        message: 'lido provider requires requestIds for prepareClaim',
        errors: [{ field: 'requestIds', reason: 'missing' }],
      });
    }
    try {
      const tx = await this.lidoService.claimWithdrawals(
        input.userAddress,
        input.requestIds,
      );
      return this.unwrapTransactions(tx.transactionData, input.chainId, 'claim-withdrawals');
    } catch (e) {
      throw this.toCapabilityError(e, 'prepareClaim');
    }
  }

  async getApr(asset: string, chainId: ChainId): Promise<number | null> {
    if (chainId !== ETHEREUM_CHAIN_ID) return null;
    if (asset.toUpperCase() !== 'ETH') return null;
    const info = await this.lidoService.getProtocolInfo();
    return info.currentAPY;
  }

  // -----------------------------------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------------------------------

  private ensureChain(chainId: ChainId, where: string): void {
    if (chainId !== ETHEREUM_CHAIN_ID) {
      throw CapabilityError.unsupportedRoute({
        capability: 'staking',
        chainId,
        attempted: ['lido'],
        fromAsset: 'ETH',
        toAsset: 'stETH',
      });
    }
    this.logger?.info(`[LidoProviderAdapter] ${where} chain=${chainId}`);
  }

  /**
   * Convert the legacy `StakingTransaction.transactionData` into the envelope `Transaction[]`.
   *
   * `transactionData` carries a single tx today; when LidoService eventually issues multi-step
   * bundles (stake-with-permit), this method returns more entries. Always returns at least one.
   */
  private unwrapTransactions(
    data: { to: string; data: string; value: string; gasLimit: string; chainId: number } | undefined,
    expectedChainId: ChainId,
    action: string,
  ): Transaction[] {
    if (!data) {
      throw new CapabilityError({
        code: 'CAPABILITY_STAKING_PROVIDER_FAILURE',
        category: ErrorCategory.PROVIDER_FAILURE,
        message: `Lido did not return transaction data for ${action}`,
        provider: 'lido',
      });
    }
    return [
      {
        chainId: data.chainId ?? expectedChainId,
        to: data.to,
        data: data.data,
        value: data.value,
        gasLimit: data.gasLimit,
        action,
      },
    ];
  }

  private toCapabilityError(e: unknown, where: string): CapabilityError {
    if (CapabilityError.is(e)) return e;
    const message = (e as Error).message ?? String(e);
    if (/Insufficient stETH/i.test(message)) {
      return CapabilityError.validation({
        capability: 'staking',
        message,
        errors: [{ field: 'amount', reason: 'insufficient-balance' }],
      });
    }
    if (/Amount must be greater than 0|Amount is required|wei string/i.test(message)) {
      return CapabilityError.validation({ capability: 'staking', message });
    }
    return CapabilityError.providerFailure({
      capability: 'staking',
      provider: 'lido',
      message: `lido ${where} failed: ${message}`,
      cause: e,
    });
  }
}
