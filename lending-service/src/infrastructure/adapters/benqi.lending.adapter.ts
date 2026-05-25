/**
 * BenqiLendingAdapter — fallback read-only lending provider.
 *
 * Calls the legacy /benqi/* routes of this very service (localhost:3007 in production)
 * to fetch market data and user positions. It does NOT prepare transactions — that
 * responsibility stays with ExecutionLayerLendingAdapter.
 *
 * supportsRoute returns false for any prepare-* action so the registry
 * never routes those here.
 */

import {
  CapabilityError,
  type ProviderHealth,
  type ProviderMetadata,
  type Transaction,
} from "@panorama/capability";

import type {
  HistoryEntry,
  ILendingProvider,
  LendingMarket,
  LendingRouteParams,
  PrepareBorrowReq,
  PrepareRepayReq,
  PrepareSupplyReq,
  PrepareWithdrawReq,
  UserPositionsResult,
} from "../../domain/ports/lending.provider.port";

const PREPARE_ACTIONS = new Set(["supply", "withdraw", "borrow", "repay"]);

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
}

export class BenqiLendingAdapter implements ILendingProvider {
  readonly name = "benqi";
  readonly metadata: ProviderMetadata = {
    name: "benqi",
    capability: "lending",
    supportedChains: [43114],
    features: ["markets", "position", "history"],
    version: "1.0.0",
  };

  private readonly selfBaseUrl: string;

  constructor(selfBaseUrl?: string) {
    // Points back to this service's own legacy routes.
    this.selfBaseUrl =
      selfBaseUrl ??
      `http://localhost:${process.env.PORT ?? 3007}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.selfBaseUrl}${path}`);
    return safeJson(res);
  }

  // ─── ILendingProvider ────────────────────────────────────────────────────

  async supportsRoute(params: LendingRouteParams): Promise<boolean> {
    if (!this.metadata.supportedChains.includes(params.chainId)) return false;
    // Benqi adapter is read-only: never handle prepare-* actions.
    if (PREPARE_ACTIONS.has(params.action)) return false;
    return true;
  }

  async getMarkets(chainId: number): Promise<LendingMarket[]> {
    try {
      const data = await this.get<any>("/benqi/markets");
      const raw = data.data?.markets ?? data.markets ?? [];
      return raw.map((m: any) => ({
        chainId: m.chainId ?? chainId,
        protocol: m.protocol ?? "benqi",
        qTokenAddress: m.qTokenAddress,
        qTokenSymbol: m.qTokenSymbol,
        underlyingAddress: m.underlyingAddress ?? "native",
        underlyingSymbol: m.underlyingSymbol,
        underlyingDecimals: m.underlyingDecimals ?? 18,
        collateralFactorBps: m.collateralFactorBps ?? null,
        supplyApyBps: m.supplyApyBps ?? null,
        borrowApyBps: m.borrowApyBps ?? null,
      }));
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: "lending",
        provider: this.name,
        message: `Benqi getMarkets failed: ${(err as Error).message ?? err}`,
        cause: err,
      });
    }
  }

  async getUserPosition(userAddress: string, chainId: number): Promise<UserPositionsResult> {
    try {
      const data = await this.get<any>(`/benqi/account/${userAddress}/positions`);
      // Legacy route wraps in { data: { positions, liquidity, ... } }
      const inner = data.data ?? data;
      return {
        accountAddress: userAddress,
        liquidity: {
          accountAddress: userAddress,
          liquidity: inner.liquidity?.liquidity ?? "0",
          shortfall: inner.liquidity?.shortfall ?? "0",
          isHealthy: inner.liquidity?.isHealthy ?? true,
        },
        positions: (inner.positions ?? []).map((p: any) => ({
          chainId: p.chainId ?? chainId,
          protocol: p.protocol ?? "benqi",
          qTokenAddress: p.qTokenAddress,
          qTokenSymbol: p.qTokenSymbol,
          underlyingAddress: p.underlyingAddress ?? "native",
          underlyingSymbol: p.underlyingSymbol,
          underlyingDecimals: p.underlyingDecimals ?? 18,
          qTokenDecimals: p.qTokenDecimals ?? 8,
          qTokenBalanceWei: p.qTokenBalanceWei ?? "0",
          suppliedWei: p.suppliedWei ?? "0",
          borrowedWei: p.borrowedWei ?? "0",
          collateralEnabled: p.collateralEnabled ?? false,
        })),
        updatedAt: inner.updatedAt ?? Date.now(),
        ...(inner.warnings?.length ? { warnings: inner.warnings } : {}),
      };
    } catch (err) {
      throw CapabilityError.providerFailure({
        capability: "lending",
        provider: this.name,
        message: `Benqi getUserPosition failed: ${(err as Error).message ?? err}`,
        cause: err,
      });
    }
  }

  // Prepare actions are not supported — these will never be called because
  // supportsRoute returns false for them, but we implement them to satisfy the interface.

  async prepareSupply(_req: PrepareSupplyReq): Promise<Transaction[]> {
    throw CapabilityError.unsupportedRoute({
      capability: "lending",
      chainId: _req.chainId,
      attempted: [this.name],
    });
  }

  async prepareWithdraw(_req: PrepareWithdrawReq): Promise<Transaction[]> {
    throw CapabilityError.unsupportedRoute({
      capability: "lending",
      chainId: _req.chainId,
      attempted: [this.name],
    });
  }

  async prepareBorrow(_req: PrepareBorrowReq): Promise<Transaction[]> {
    throw CapabilityError.unsupportedRoute({
      capability: "lending",
      chainId: _req.chainId,
      attempted: [this.name],
    });
  }

  async prepareRepay(_req: PrepareRepayReq): Promise<Transaction[]> {
    throw CapabilityError.unsupportedRoute({
      capability: "lending",
      chainId: _req.chainId,
      attempted: [this.name],
    });
  }

  async getHistory(userAddress: string, _chainId: number): Promise<HistoryEntry[]> {
    try {
      const data = await this.get<any>(`/benqi/account/${userAddress}/history`);
      const txs = data.data?.transactions ?? [];
      return txs.map((t: any) => ({
        id: t.id ?? t._id ?? String(Math.random()),
        action: t.action,
        qTokenAddress: t.metadata?.qTokenAddress ?? "",
        amountWei: t.amountWei ?? "0",
        status: t.status ?? "confirmed",
        txHash: t.txHash,
        createdAt: t.createdAt ?? new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const data = await this.get<any>("/health");
      const healthy = data?.status === "healthy" || data?.status === "degraded";
      return {
        healthy,
        latencyMs: Date.now() - start,
        reason: healthy ? undefined : `status=${data?.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: String((err as Error).message ?? err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
