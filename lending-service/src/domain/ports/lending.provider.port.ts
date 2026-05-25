/**
 * ILendingProvider — lending capability port.
 *
 * Every lending provider (ExecutionLayer, Benqi direct) implements this interface.
 * The LendingCapabilityService facade speaks only this port — never a concrete adapter.
 *
 * Avalanche / Benqi focus (chainId 43114) but typed generically so other chains can be added.
 *
 * See ADR 002 + shared/capability/CONVENTIONS.md.
 */

import type {
  Address,
  ChainId,
  ICapabilityProvider,
  Transaction,
  WeiString,
} from "@panorama/capability";

// ─── Route params ─────────────────────────────────────────────────────────────

export interface LendingRouteParams {
  chainId: ChainId;
  /** "supply" | "withdraw" | "borrow" | "repay" | "markets" | "position" | "history" */
  action: string;
  /** qToken / market address — required for action-specific routes. */
  qTokenAddress?: Address;
}

// ─── Domain entities ──────────────────────────────────────────────────────────

export interface LendingMarket {
  chainId: ChainId;
  protocol: string;
  qTokenAddress: Address;
  qTokenSymbol: string;
  underlyingAddress: Address | "native";
  underlyingSymbol: string;
  underlyingDecimals: number;
  collateralFactorBps: number | null;
  supplyApyBps: number | null;
  borrowApyBps: number | null;
}

export interface UserPosition {
  chainId: ChainId;
  protocol: string;
  qTokenAddress: Address;
  qTokenSymbol: string;
  underlyingAddress: Address | "native";
  underlyingSymbol: string;
  underlyingDecimals: number;
  qTokenDecimals: number;
  qTokenBalanceWei: WeiString;
  suppliedWei: WeiString;
  borrowedWei: WeiString;
  collateralEnabled: boolean;
}

export interface AccountLiquidity {
  accountAddress: Address;
  liquidity: WeiString;
  shortfall: WeiString;
  isHealthy: boolean;
}

export interface UserPositionsResult {
  accountAddress: Address;
  liquidity: AccountLiquidity;
  positions: UserPosition[];
  updatedAt: number;
  warnings?: string[];
}

export interface HistoryEntry {
  id: string;
  action: "supply" | "withdraw" | "borrow" | "repay";
  qTokenAddress: Address;
  amountWei: WeiString;
  status: "pending" | "confirmed" | "failed";
  txHash?: string;
  createdAt: string;
}

// ─── Prepare-action request shapes ───────────────────────────────────────────

export interface PrepareSupplyReq {
  userAddress: Address;
  chainId: ChainId;
  qTokenAddress: Address;
  /** Amount in wei (underlying). */
  amount: WeiString;
}

export interface PrepareWithdrawReq {
  userAddress: Address;
  chainId: ChainId;
  qTokenAddress: Address;
  /** qToken amount when redeeming by receipt token; underlying when redeeming by asset. */
  amount: WeiString;
  /** true = redeem by underlying amount (redeemUnderlying); false = by qToken amount (redeem). */
  byUnderlying?: boolean;
}

export interface PrepareBorrowReq {
  userAddress: Address;
  chainId: ChainId;
  qTokenAddress: Address;
  amount: WeiString;
}

export interface PrepareRepayReq {
  userAddress: Address;
  chainId: ChainId;
  qTokenAddress: Address;
  amount: WeiString;
}

// ─── Quote shape ──────────────────────────────────────────────────────────────

export interface LendingQuote {
  qTokenAddress: Address;
  estimatedAmount: WeiString;
  feeWei: WeiString;
  netAmount: WeiString;
  /** Optional extra data from the provider (e.g. validation fee breakdown). */
  extra?: Record<string, unknown>;
}

// ─── The port ─────────────────────────────────────────────────────────────────

export interface ILendingProvider extends ICapabilityProvider {
  /**
   * True if this provider can serve the given action / qToken / chain combination.
   * The registry already filters by `metadata.supportedChains`; this is for finer-grained
   * checks (e.g. ExecutionLayer handles prepare actions; Benqi handles reads only).
   */
  supportsRoute(params: LendingRouteParams): Promise<boolean>;

  /**
   * Return all lending markets available on the given chain.
   */
  getMarkets(chainId: ChainId): Promise<LendingMarket[]>;

  /**
   * Return all open positions (supply + borrow) for a user.
   */
  getUserPosition(userAddress: Address, chainId: ChainId): Promise<UserPositionsResult>;

  /**
   * Build the transaction set needed to supply `req.amount` of underlying into `req.qTokenAddress`.
   * May include an ERC-20 approve step before the mint call.
   */
  prepareSupply(req: PrepareSupplyReq): Promise<Transaction[]>;

  /**
   * Build the transaction set needed to withdraw (redeem) from a qToken market.
   */
  prepareWithdraw(req: PrepareWithdrawReq): Promise<Transaction[]>;

  /**
   * Build the transaction needed to borrow `req.amount` from a qToken market.
   */
  prepareBorrow(req: PrepareBorrowReq): Promise<Transaction[]>;

  /**
   * Build the transaction needed to repay an outstanding borrow.
   * May include an ERC-20 approve step.
   */
  prepareRepay(req: PrepareRepayReq): Promise<Transaction[]>;

  /**
   * Return lending transaction history for a user (from DB gateway or on-chain index).
   * Returns an empty array when history is unavailable — never throws for missing history.
   */
  getHistory(userAddress: Address, chainId: ChainId): Promise<HistoryEntry[]>;

  /**
   * Optional health probe. If absent the provider is treated as always healthy.
   */
  healthCheck?(): Promise<import("@panorama/capability").ProviderHealth>;
}
