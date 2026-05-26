/**
 * Aerodrome LP adapter — wraps the Execution Layer's Aerodrome router for
 * add/remove liquidity on Base. Pool discovery and APR come from on-chain reads.
 */

import type { ProviderMetadata, Transaction } from '@panorama/capability';
import { CapabilityError } from '@panorama/capability';
import type {
  ILiquidityProvider,
  LiquidityRouteParams,
  PrepareAddInput,
  PrepareRemoveInput,
  PrepareClaimInput,
} from '../../domain/ports/liquidity.provider.port';
import type { Pool, LpPosition, GetPoolsFilter } from '../../domain/entities/pool';
import axios, { AxiosInstance } from 'axios';

const BASE_CHAIN_ID = 8453;

export class AerodromeLpAdapter implements ILiquidityProvider {
  public readonly name = 'aerodrome-lp';
  public readonly metadata: ProviderMetadata = {
    name: 'aerodrome-lp',
    capability: 'liquidity',
    supportedChains: [BASE_CHAIN_ID],
    features: ['volatile', 'stable', 'gauge-rewards'],
    version: '1.0.0',
    enabled: true,
  };

  private readonly client: AxiosInstance;

  constructor() {
    const base = process.env.EXECUTION_SERVICE_URL || process.env.EXECUTION_LAYER_URL || 'http://localhost:3010';
    this.client = axios.create({
      baseURL: `${base.replace(/\/+$/, '')}/staking`,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async supportsRoute(params: LiquidityRouteParams): Promise<boolean> {
    return params.chainId === BASE_CHAIN_ID;
  }

  async getPools(filter: GetPoolsFilter): Promise<Pool[]> {
    if (filter.chainId !== BASE_CHAIN_ID) return [];
    try {
      const res = await this.client.get('/pools', { params: { type: filter.type, limit: filter.limit } });
      return (res.data.pools ?? []).map((p: any) => ({
        id: p.address ?? p.id,
        chainId: BASE_CHAIN_ID,
        provider: this.name,
        type: p.stable ? 'stable' : 'volatile',
        assets: [
          { address: p.token0, symbol: p.symbol0, decimals: p.decimals0 },
          { address: p.token1, symbol: p.symbol1, decimals: p.decimals1 },
        ],
        tvlUsd: p.tvlUsd,
        aprPercent: p.apr,
        metadata: { gauge: p.gauge },
      })) as Pool[];
    } catch (e) {
      throw CapabilityError.providerFailure({
        capability: 'liquidity',
        provider: this.name,
        message: `getPools failed: ${(e as Error).message}`,
        cause: e,
      });
    }
  }

  async getPosition(userAddress: string, poolId: string): Promise<LpPosition | null> {
    try {
      const res = await this.client.get(`/position/${userAddress}/${poolId}`);
      if (!res.data || res.data.lpBalanceWei === '0') return null;
      return res.data as LpPosition;
    } catch {
      return null;
    }
  }

  async prepareAdd(input: PrepareAddInput): Promise<Transaction[]> {
    try {
      const res = await this.client.post('/prepare-add', {
        userAddress: input.userAddress,
        poolId: input.poolId,
        amounts: input.amounts,
        stake: input.stake ?? false,
        slippageBps: input.slippageBps ?? 50,
      });
      return res.data.transactions ?? [];
    } catch (e) {
      throw CapabilityError.providerFailure({
        capability: 'liquidity',
        provider: this.name,
        message: `prepareAdd failed: ${(e as Error).message}`,
        cause: e,
      });
    }
  }

  async prepareRemove(input: PrepareRemoveInput): Promise<Transaction[]> {
    try {
      const res = await this.client.post('/prepare-remove', {
        userAddress: input.userAddress,
        poolId: input.poolId,
        lpAmountWei: input.lpAmountWei,
        slippageBps: input.slippageBps ?? 50,
        unstakeFirst: input.unstakeFirst ?? false,
      });
      return res.data.transactions ?? [];
    } catch (e) {
      throw CapabilityError.providerFailure({
        capability: 'liquidity',
        provider: this.name,
        message: `prepareRemove failed: ${(e as Error).message}`,
        cause: e,
      });
    }
  }

  async prepareClaim(input: PrepareClaimInput): Promise<Transaction[]> {
    try {
      const res = await this.client.post('/prepare-claim', {
        userAddress: input.userAddress,
        poolId: input.poolId,
        rewardAssets: input.rewardAssets,
      });
      return res.data.transactions ?? [];
    } catch (e) {
      throw CapabilityError.providerFailure({
        capability: 'liquidity',
        provider: this.name,
        message: `prepareClaim failed: ${(e as Error).message}`,
        cause: e,
      });
    }
  }

  async getApr(poolId: string, chainId: number): Promise<number | null> {
    if (chainId !== BASE_CHAIN_ID) return null;
    try {
      const res = await this.client.get(`/apr/${poolId}`);
      return res.data?.apr ?? null;
    } catch {
      return null;
    }
  }
}
