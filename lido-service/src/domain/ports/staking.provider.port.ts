/**
 * IStakingProvider — staking capability port.
 *
 * Every staking provider (Lido, Base cbETH stub, future sAVAX/sFRAX) implements this interface.
 * The staking capability facade (`StakingCapabilityService`) speaks only this port — never an
 * adapter concrete class.
 *
 * See ADR 002 (capability + provider) and CONVENTIONS.md from `@panorama/capability`.
 *
 * Card #244 (SPRINT_HUGO.md).
 */

import type {
  Address,
  ChainId,
  ICapabilityProvider,
  Transaction,
} from "@panorama/capability";

// -------------------------------------------------------------------------------------------------
// Per-action request shapes (domain inputs that the port consumes)
// -------------------------------------------------------------------------------------------------

export interface StakingRouteParams {
  chainId: ChainId;
  /** Asset symbol or address. Optional — provider falls back to its default (usually native). */
  asset?: string;
}

export interface PrepareStakeInput {
  userAddress: Address;
  chainId: ChainId;
  /** Wei amount as decimal string. */
  amount: string;
  /** Asset symbol or address. */
  asset?: string;
}

export interface PrepareUnstakeInput {
  userAddress: Address;
  chainId: ChainId;
  amount: string;
  asset?: string;
}

export interface PrepareClaimInput {
  userAddress: Address;
  chainId: ChainId;
  /** Optional explicit withdrawal request ids (Lido uses these). */
  requestIds?: string[];
}

// -------------------------------------------------------------------------------------------------
// Domain entity returned by `getPosition` — kept minimal so all providers can populate it.
// -------------------------------------------------------------------------------------------------

export interface CapabilityStakingPosition {
  /** Native staked amount in wei. */
  stakedAmountWei: string;
  /** Liquid receipt token balance (e.g. stETH for Lido). Wei. */
  receiptTokenBalanceWei: string;
  /** Receipt token symbol (e.g. "stETH"). */
  receiptTokenSymbol: string;
  /** Current APR (annualised yield) — null when unknown. */
  apr: number | null;
  /** Provider-specific extras (e.g. wstETH balance for Lido). */
  extra?: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// The port
// -------------------------------------------------------------------------------------------------

export interface IStakingProvider extends ICapabilityProvider {
  /**
   * True if this provider can serve `chainId` (and optionally `asset`). The registry already
   * filters by `metadata.supportedChains`; `supportsRoute` is for finer-grained filtering
   * (e.g. Lido on Ethereum supports ETH but rejects USDC).
   */
  supportsRoute(params: StakingRouteParams): Promise<boolean>;

  /**
   * Get the user's current staking position. Returns null when the user has never staked
   * with this provider.
   */
  getPosition(
    userAddress: Address,
    chainId: ChainId
  ): Promise<CapabilityStakingPosition | null>;

  /**
   * Build the transactions needed to stake `input.amount` of the asset.
   * Multi-step (approve + stake) returns multiple transactions in order.
   */
  prepareStake(input: PrepareStakeInput): Promise<Transaction[]>;

  /**
   * Build the transactions needed to unstake `input.amount`. For Lido this typically creates
   * a withdrawal request the user later claims via `prepareClaim`.
   */
  prepareUnstake(input: PrepareUnstakeInput): Promise<Transaction[]>;

  /**
   * Build the transactions needed to claim finalized withdrawals.
   * `input.requestIds` is mandatory for providers with explicit request queues (Lido); for
   * providers with implicit claims (e.g. liquid restaking) the field is ignored.
   */
  prepareClaim(input: PrepareClaimInput): Promise<Transaction[]>;

  /**
   * Current APR for `asset` on `chainId`. Null when the provider can't report APR.
   */
  getApr(asset: string, chainId: ChainId): Promise<number | null>;
}
