/**
 * ILiquidityProvider — liquidity capability port.
 *
 * Every LP provider (Aerodrome on Base, Trader Joe LB on Avax, future Uniswap V4 LP) implements
 * this interface. The capability facade (`LiquidityCapabilityService`) speaks only this port —
 * never an adapter concrete class.
 *
 * Card #250. See:
 * - `@panorama/capability/provider.types.ts` for `ICapabilityProvider`
 * - `liquidity-service/docs/liquidity-capability.md` for the contract narrative
 * - SPRINT_KICKOFF.md §3 "Capability + Provider pattern"
 * - ADR 002 (capability + provider)
 */

import type {
  Address,
  ChainId,
  ICapabilityProvider,
  Transaction,
} from '@panorama/capability';

import type { GetPoolsFilter, LpPosition, Pool } from '../entities/pool';

// -------------------------------------------------------------------------------------------------
// Route params — fine-grained reachability check beyond `metadata.supportedChains`
// -------------------------------------------------------------------------------------------------

export interface LiquidityRouteParams {
  chainId: ChainId;
  /** Optional pool identifier — when present, providers may probe pool existence/state. */
  poolId?: string;
  /** Optional asset pair (addresses). When present, providers can reject unsupported pairs. */
  assets?: [Address, Address];
}

// -------------------------------------------------------------------------------------------------
// Action inputs
// -------------------------------------------------------------------------------------------------

export interface PrepareAddInput {
  userAddress: Address;
  chainId: ChainId;
  poolId: string;
  /** Desired amounts of each asset to deposit, in wei. */
  amounts: [string, string];
  /** Optional stake-into-gauge flag (Aerodrome boosts). Default `false`. */
  stake?: boolean;
  /** Slippage tolerance in basis points (1 bp = 0.01%). Provider chooses a sane default. */
  slippageBps?: number;
}

export interface PrepareRemoveInput {
  userAddress: Address;
  chainId: ChainId;
  poolId: string;
  /** LP token amount (wei) to withdraw. */
  lpAmountWei: string;
  /** Slippage tolerance in basis points (1 bp = 0.01%). */
  slippageBps?: number;
  /** When `true`, also unstake from gauge before removing. */
  unstakeFirst?: boolean;
}

export interface PrepareClaimInput {
  userAddress: Address;
  chainId: ChainId;
  poolId: string;
  /** Restrict to specific reward assets. When absent, claim all available. */
  rewardAssets?: Address[];
}

// -------------------------------------------------------------------------------------------------
// The port
// -------------------------------------------------------------------------------------------------

export interface ILiquidityProvider extends ICapabilityProvider {
  /**
   * Fine-grained reachability check. The registry already filters by `metadata.supportedChains`;
   * `supportsRoute` adds per-pool / per-asset rejection (e.g. provider supports Base but not the
   * concentrated-liquidity pool id passed in).
   *
   * Lightweight — should not call the network unless absolutely necessary. Any failure → `false`.
   */
  supportsRoute(params: LiquidityRouteParams): Promise<boolean>;

  /**
   * List LP pools the provider considers active on the given chain. Pagination is provider-defined
   * via `filter.cursor` / `filter.limit`.
   */
  getPools(filter: GetPoolsFilter): Promise<Pool[]>;

  /**
   * The user's LP position on `poolId`. Returns `null` when the user has never deposited.
   * Implementations should be cheap — caller may poll this; cache aggressively at adapter level.
   */
  getPosition(
    userAddress: Address,
    poolId: string
  ): Promise<LpPosition | null>;

  /**
   * Build the transactions needed to add liquidity. Multi-step:
   * 1. Optional `approve(asset0)` and `approve(asset1)` when current allowance is insufficient
   * 2. `addLiquidity(...)` on the router/pool
   * 3. Optional `stake(...)` into a gauge when `input.stake === true`
   */
  prepareAdd(input: PrepareAddInput): Promise<Transaction[]>;

  /**
   * Build the transactions needed to remove liquidity. Multi-step:
   * 1. Optional `unstake(...)` from gauge when `input.unstakeFirst === true`
   * 2. Optional `approve(lpToken)` when current router allowance is insufficient
   * 3. `removeLiquidity(...)` on the router/pool
   */
  prepareRemove(input: PrepareRemoveInput): Promise<Transaction[]>;

  /**
   * Build the transactions needed to claim rewards. Single-step for most providers (`claim` on
   * the gauge/distributor). Some providers may emit multiple txs when multiple reward distributors
   * are active.
   */
  prepareClaim(input: PrepareClaimInput): Promise<Transaction[]>;

  /**
   * Annual percentage rate for `poolId`. Aggregates trading fees + reward emissions when both
   * are present. Returns `null` when the provider cannot compute it cheaply.
   */
  getApr(poolId: string, chainId: ChainId): Promise<number | null>;
}
