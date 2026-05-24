/**
 * Domain entities for the liquidity capability.
 * Provider-specific extras live in `metadata` / `extra` records.
 */

import type { Address, ChainId, WeiString } from '@panorama/capability';

/**
 * Pool type — broad classifier. Providers extend semantics via `metadata`.
 */
export type PoolType = 'volatile' | 'stable' | 'concentrated' | 'weighted';

/**
 * AssetRef — opaque token reference. `address` is the canonical identifier; `symbol`/`decimals`
 * are convenience fields populated by providers when known.
 */
export interface AssetRef {
  address: Address;
  symbol?: string;
  decimals?: number;
}

/**
 * Pool — provider-agnostic LP pool descriptor returned by `getPools`.
 *
 * `id` is the canonical pool identifier. For UniV2/Aerodrome volatile/stable it is the pool
 * contract address; for concentrated-liquidity (UniV3, V4, Trader Joe LB) it is provider-specific
 * (e.g. `factory:tokenA:tokenB:fee`). Consumers should treat it as opaque.
 */
export interface Pool {
  id: string;
  chainId: ChainId;
  provider: string;
  type: PoolType;
  assets: [AssetRef, AssetRef];
  /** TVL in USD, when the provider can compute it. */
  tvlUsd?: number;
  /** Annual percentage rate (rewards + fees), when known. */
  aprPercent?: number;
  /** Reserves of each asset in wei. Optional — some providers don't expose them cheaply. */
  reserves?: [WeiString, WeiString];
  /** Provider-specific extras (gauge address, fee tier, tickSpacing, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * LpPosition — user's stake in a pool. Returned by `getPosition`. `null` when the user
 * has never interacted with the pool.
 */
export interface LpPosition {
  poolId: string;
  chainId: ChainId;
  userAddress: Address;
  /** LP receipt token balance (wei). For UniV3-style providers, sum across position NFTs. */
  lpBalanceWei: WeiString;
  /** Fraction of total supply in [0, 1]. Null when total supply is unknowable cheaply. */
  shareOfPool: number | null;
  /** Underlying asset amounts the user is entitled to right now (after IL). */
  underlying?: {
    asset0Wei: WeiString;
    asset1Wei: WeiString;
  };
  /** Claimable rewards per asset. Empty when the pool has no rewards programme. */
  claimableRewards: Array<{ asset: AssetRef; amountWei: WeiString }>;
  /** Provider-specific extras. */
  extra?: Record<string, unknown>;
}

/**
 * GetPoolsFilter — narrows the result set of `getPools`. All fields optional; an empty filter
 * returns all pools the provider considers active on `chainId`.
 */
export interface GetPoolsFilter {
  chainId: ChainId;
  /** Pool type filter (e.g. only stable pools). */
  type?: PoolType;
  /** Restrict to pools containing this asset (address). */
  asset?: Address;
  /** Pagination — provider-defined cursor / limit. */
  limit?: number;
  cursor?: string;
}
