/**
 * LendingCapabilityService — facade for the lending capability.
 *
 * Orchestrates ProviderRegistry<ILendingProvider> + IPriorityPolicy so routes never
 * import concrete adapters. All /v1/capability/lend/* endpoints go through this class.
 *
 * Provider priority (chain 43114):
 *   1. execution-layer  — prepare-* + reads (primary)
 *   2. benqi            — reads only, fallback when execution-layer is down
 */

import {
  CapabilityError,
  fallbackInvoke,
  type Address,
  type CapabilityRequest,
  type ChainId,
  type IPriorityPolicy,
  type ProviderRegistry,
  type Transaction,
} from "@panorama/capability";

import type {
  HistoryEntry,
  ILendingProvider,
  LendingMarket,
  PrepareBorrowReq,
  PrepareRepayReq,
  PrepareSupplyReq,
  PrepareWithdrawReq,
  UserPositionsResult,
} from "../../domain/ports/lending.provider.port";

// ─── Public shapes ────────────────────────────────────────────────────────────

export interface LendingFacadeDeps {
  registry: ProviderRegistry<ILendingProvider>;
  policy: IPriorityPolicy;
}

export interface LendingActionOutcome<TData> {
  data: TData;
  provider: { name: string; metadata?: Record<string, unknown> };
  attempts: { provider: string; reason: string }[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LendingCapabilityService {
  private readonly registry: ProviderRegistry<ILendingProvider>;
  private readonly policy: IPriorityPolicy;

  constructor(deps: LendingFacadeDeps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
  }

  // ─── Markets (read) ──────────────────────────────────────────────────────

  async getMarkets(
    req: CapabilityRequest<Record<string, never>>,
  ): Promise<LendingActionOutcome<LendingMarket[]>> {
    const ranked = this.rankCandidates(req.chainId, "markets");
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute({ chainId: req.chainId, action: "markets" }),
      invoke: (p) => p.getMarkets(req.chainId),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Position (read) ─────────────────────────────────────────────────────

  async getUserPosition(
    req: CapabilityRequest<Record<string, never>>,
  ): Promise<LendingActionOutcome<UserPositionsResult>> {
    const ranked = this.rankCandidates(req.chainId, "position");
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute({ chainId: req.chainId, action: "position" }),
      invoke: (p) => p.getUserPosition(req.userAddress, req.chainId),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Prepare supply ──────────────────────────────────────────────────────

  async prepareSupply(
    req: CapabilityRequest<{ qTokenAddress: Address; amount: string }>,
  ): Promise<LendingActionOutcome<Transaction[]>> {
    const { qTokenAddress, amount } = req.payload;
    const input: PrepareSupplyReq = {
      userAddress: req.userAddress,
      chainId: req.chainId,
      qTokenAddress,
      amount,
    };
    const ranked = this.rankCandidates(req.chainId, "supply", qTokenAddress);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, action: "supply", qTokenAddress }),
      invoke: (p) => p.prepareSupply(input),
      capability: "lending",
      shouldFallback: (err) =>
        CapabilityError.is(err) && (err as CapabilityError).category === "VALIDATION"
          ? "rethrow"
          : "fallback",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Prepare withdraw ────────────────────────────────────────────────────

  async prepareWithdraw(
    req: CapabilityRequest<{ qTokenAddress: Address; amount: string; byUnderlying?: boolean }>,
  ): Promise<LendingActionOutcome<Transaction[]>> {
    const { qTokenAddress, amount, byUnderlying } = req.payload;
    const input: PrepareWithdrawReq = {
      userAddress: req.userAddress,
      chainId: req.chainId,
      qTokenAddress,
      amount,
      byUnderlying,
    };
    const ranked = this.rankCandidates(req.chainId, "withdraw", qTokenAddress);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, action: "withdraw", qTokenAddress }),
      invoke: (p) => p.prepareWithdraw(input),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Prepare borrow ──────────────────────────────────────────────────────

  async prepareBorrow(
    req: CapabilityRequest<{ qTokenAddress: Address; amount: string }>,
  ): Promise<LendingActionOutcome<Transaction[]>> {
    const { qTokenAddress, amount } = req.payload;
    const input: PrepareBorrowReq = {
      userAddress: req.userAddress,
      chainId: req.chainId,
      qTokenAddress,
      amount,
    };
    const ranked = this.rankCandidates(req.chainId, "borrow", qTokenAddress);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, action: "borrow", qTokenAddress }),
      invoke: (p) => p.prepareBorrow(input),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Prepare repay ───────────────────────────────────────────────────────

  async prepareRepay(
    req: CapabilityRequest<{ qTokenAddress: Address; amount: string }>,
  ): Promise<LendingActionOutcome<Transaction[]>> {
    const { qTokenAddress, amount } = req.payload;
    const input: PrepareRepayReq = {
      userAddress: req.userAddress,
      chainId: req.chainId,
      qTokenAddress,
      amount,
    };
    const ranked = this.rankCandidates(req.chainId, "repay", qTokenAddress);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, action: "repay", qTokenAddress }),
      invoke: (p) => p.prepareRepay(input),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── History (read) ──────────────────────────────────────────────────────

  async getHistory(
    req: CapabilityRequest<Record<string, never>>,
  ): Promise<LendingActionOutcome<HistoryEntry[]>> {
    const ranked = this.rankCandidates(req.chainId, "history");
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute({ chainId: req.chainId, action: "history" }),
      invoke: (p) => p.getHistory(req.userAddress, req.chainId),
      capability: "lending",
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: (outcome as any).provider.name },
      attempts: outcome.attempts,
    };
  }

  // ─── Discovery ───────────────────────────────────────────────────────────

  listProviders(): ILendingProvider[] {
    return this.registry.listAll({ capability: "lending" });
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private rankCandidates(
    chainId: ChainId,
    action: string,
    asset?: string,
  ): ILendingProvider[] {
    const candidates = this.registry.listByChain(chainId, { capability: "lending" });
    if (candidates.length === 0) {
      throw CapabilityError.unsupportedRoute({
        capability: "lending",
        chainId,
        attempted: [],
        ...(asset && { fromAsset: asset }),
      });
    }
    return this.policy.rank(candidates, { chainId, action, ...(asset && { asset }) });
  }
}
