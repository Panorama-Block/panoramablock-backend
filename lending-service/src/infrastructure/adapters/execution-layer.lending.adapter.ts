/**
 * ExecutionLayerLendingAdapter — primary lending provider.
 *
 * Delegates prepare-* actions and position reads to the execution-layer service
 * via HTTP (EXECUTION_LAYER_URL env var, default localhost:3011).
 *
 * Circuit breaker: 3 consecutive failures → marks unhealthy for 60s.
 * After 60s the next call re-attempts and, if it succeeds, resets the breaker.
 */

import {
  CapabilityError,
  type ProviderHealth,
  type ProviderMetadata,
  type Transaction,
} from "@panorama/capability";

import type {
  AccountLiquidity,
  HistoryEntry,
  ILendingProvider,
  LendingMarket,
  LendingRouteParams,
  PrepareBorrowReq,
  PrepareRepayReq,
  PrepareSupplyReq,
  PrepareWithdrawReq,
  UserPosition,
  UserPositionsResult,
} from "../../domain/ports/lending.provider.port";

// ─── Circuit breaker state ────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function isConnectionError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err);
  const code = String((err as any)?.cause?.code ?? (err as any)?.code ?? "");
  return (
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(code) ||
    /fetch failed|ECONNREFUSED|not valid JSON/i.test(msg)
  );
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
}

/**
 * Map an execution-layer TransactionBundle steps array → canonical Transaction[].
 * Steps come as { to, data, value, chainId } — matches the Transaction shape directly.
 */
function stepsToTransactions(steps: any[]): Transaction[] {
  return (steps ?? []).map((s: any) => ({
    chainId: s.chainId ?? 43114,
    to: s.to,
    data: s.data ?? "0x",
    value: String(s.value ?? "0"),
    ...(s.gasLimit && { gasLimit: String(s.gasLimit) }),
    feeMode: "advisory" as const,
    action: s.action,
    description: s.description,
  }));
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ExecutionLayerLendingAdapter implements ILendingProvider {
  readonly name = "execution-layer";
  readonly metadata: ProviderMetadata = {
    name: "execution-layer",
    capability: "lending",
    supportedChains: [43114],
    features: ["supply", "withdraw", "borrow", "repay", "markets", "position"],
    version: "1.0.0",
  };

  private readonly baseUrl: string;
  private readonly breaker: BreakerState = { failures: 0, openedAt: null };

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.EXECUTION_LAYER_URL ?? "http://localhost:3011";
  }

  // ─── Circuit breaker helpers ─────────────────────────────────────────────

  private isOpen(): boolean {
    if (this.breaker.openedAt === null) return false;
    return Date.now() - this.breaker.openedAt < OPEN_DURATION_MS;
  }

  private recordSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openedAt = null;
  }

  private recordFailure(): void {
    this.breaker.failures += 1;
    if (this.breaker.failures >= FAILURE_THRESHOLD) {
      this.breaker.openedAt = Date.now();
    }
  }

  private assertNotOpen(action: string): void {
    if (this.isOpen()) {
      throw CapabilityError.providerFailure({
        capability: "lending",
        provider: this.name,
        message: `ExecutionLayer circuit breaker open — ${action} skipped. Retry in ${Math.ceil((OPEN_DURATION_MS - (Date.now() - (this.breaker.openedAt ?? 0))) / 1000)}s.`,
      });
    }
  }

  // ─── HTTP calls ──────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    return safeJson(res);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return safeJson(res);
  }

  private wrapError(action: string, err: unknown): never {
    this.recordFailure();
    if (CapabilityError.is(err)) throw err;
    throw CapabilityError.providerFailure({
      capability: "lending",
      provider: this.name,
      message: `ExecutionLayer ${action} failed: ${(err as Error).message ?? err}`,
      cause: err,
    });
  }

  // ─── ILendingProvider ────────────────────────────────────────────────────

  async supportsRoute(params: LendingRouteParams): Promise<boolean> {
    if (!this.metadata.supportedChains.includes(params.chainId)) return false;
    // ExecutionLayer handles all actions including prepare-*
    return true;
  }

  async getMarkets(chainId: number): Promise<LendingMarket[]> {
    this.assertNotOpen("getMarkets");
    try {
      const data = await this.get<any>("/avax/lending/markets");
      this.recordSuccess();
      const markets: LendingMarket[] = (data.markets ?? data.data?.markets ?? []).map((m: any) => ({
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
      return markets;
    } catch (err) {
      this.wrapError("getMarkets", err);
    }
  }

  async getUserPosition(userAddress: string, chainId: number): Promise<UserPositionsResult> {
    this.assertNotOpen("getUserPosition");
    try {
      const data = await this.get<any>(`/avax/lending/position/${userAddress}`);
      this.recordSuccess();

      const positions: UserPosition[] = (data.positions ?? []).map((p: any) => ({
        chainId: p.chainId ?? chainId,
        protocol: p.protocol ?? "benqi",
        qTokenAddress: p.qTokenAddress,
        qTokenSymbol: p.qTokenSymbol,
        underlyingAddress: p.underlyingAddress ?? "native",
        underlyingSymbol: p.underlyingSymbol,
        underlyingDecimals: p.underlyingDecimals ?? 18,
        qTokenDecimals: p.qTokenDecimals ?? 8,
        qTokenBalanceWei: p.qTokenBalance ?? p.qTokenBalanceWei ?? "0",
        suppliedWei: p.suppliedWei ?? "0",
        borrowedWei: p.borrowedWei ?? "0",
        collateralEnabled: p.collateralEnabled ?? true,
      }));

      const liquidity: AccountLiquidity = {
        accountAddress: userAddress,
        liquidity: data.liquidity?.liquidity ?? "0",
        shortfall: data.liquidity?.shortfall ?? "0",
        isHealthy: data.liquidity?.isHealthy ?? true,
      };

      return {
        accountAddress: userAddress,
        liquidity,
        positions,
        updatedAt: Date.now(),
      };
    } catch (err) {
      this.wrapError("getUserPosition", err);
    }
  }

  async prepareSupply(req: PrepareSupplyReq): Promise<Transaction[]> {
    this.assertNotOpen("prepareSupply");
    try {
      const data = await this.post<any>("/avax/lending/prepare-supply", {
        userAddress: req.userAddress,
        qTokenAddress: req.qTokenAddress,
        amount: req.amount,
      });
      this.recordSuccess();
      if (data.error) throw new Error(data.error);
      return stepsToTransactions(data.bundle?.steps ?? []);
    } catch (err) {
      this.wrapError("prepareSupply", err);
    }
  }

  async prepareWithdraw(req: PrepareWithdrawReq): Promise<Transaction[]> {
    this.assertNotOpen("prepareWithdraw");
    try {
      const data = await this.post<any>("/avax/lending/prepare-redeem", {
        userAddress: req.userAddress,
        qTokenAddress: req.qTokenAddress,
        qTokenAmount: req.byUnderlying ? undefined : req.amount,
        underlyingAmount: req.byUnderlying ? req.amount : undefined,
      });
      this.recordSuccess();
      if (data.error) throw new Error(data.error);
      return stepsToTransactions(data.bundle?.steps ?? []);
    } catch (err) {
      this.wrapError("prepareWithdraw", err);
    }
  }

  async prepareBorrow(req: PrepareBorrowReq): Promise<Transaction[]> {
    this.assertNotOpen("prepareBorrow");
    try {
      const data = await this.post<any>("/avax/lending/prepare-borrow", {
        userAddress: req.userAddress,
        qTokenAddress: req.qTokenAddress,
        amount: req.amount,
      });
      this.recordSuccess();
      if (data.error) throw new Error(data.error);
      return stepsToTransactions(data.bundle?.steps ?? []);
    } catch (err) {
      this.wrapError("prepareBorrow", err);
    }
  }

  async prepareRepay(req: PrepareRepayReq): Promise<Transaction[]> {
    this.assertNotOpen("prepareRepay");
    try {
      const data = await this.post<any>("/avax/lending/prepare-repay", {
        userAddress: req.userAddress,
        qTokenAddress: req.qTokenAddress,
        amount: req.amount,
      });
      this.recordSuccess();
      if (data.error) throw new Error(data.error);
      return stepsToTransactions(data.bundle?.steps ?? []);
    } catch (err) {
      this.wrapError("prepareRepay", err);
    }
  }

  async getHistory(_userAddress: string, _chainId: number): Promise<HistoryEntry[]> {
    // Execution layer does not expose a history endpoint; fall through to Benqi/DB-gateway adapter.
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.get<any>("/health");
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: isConnectionError(err) ? "unreachable" : String((err as Error).message ?? err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
