import axios, { AxiosInstance } from 'axios';

export type SwapQuoteRequest = {
  fromChain?: string;
  toChain?: string;
  fromChainId?: number;
  toChainId?: number;
  fromToken: string;
  toToken: string;
  amount: string;
  unit?: 'token' | 'wei';
  slippage?: number;
  smartAccountAddress?: string;
  provider?: string;
};

export type SwapPrepareResponse = {
  txData: any;
  estimatedOutput: string;
  route: any;
  provider?: string;
  providerDebug?: Record<string, unknown>;
  expiresAt?: string;
  minOutput?: string;
  stale?: boolean;
};

export type DownstreamAuthContext = {
  bearerToken?: string;
};

export class LiquidSwapClient {
  private readonly http: AxiosInstance;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly fallbackAuthToken?: string;

  constructor(baseUrl: string, authToken?: string) {
    const timeoutMs = Number(process.env.LIQUID_SWAP_TIMEOUT_MS || 10000);
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: timeoutMs,
    });
    this.fallbackAuthToken = authToken;
    this.maxRetries = Math.max(0, Number(process.env.LIQUID_SWAP_RETRY_ATTEMPTS || 2));
    this.retryBackoffMs = Math.max(0, Number(process.env.LIQUID_SWAP_RETRY_BACKOFF_MS || 250));
  }

  async getQuote(request: SwapQuoteRequest, auth?: DownstreamAuthContext) {
    const res = await this.withRetry(() => this.http.post('/swap/quote', request, this.buildRequestConfig(auth)));
    return res.data;
  }

  async prepareSwap(
    request: SwapQuoteRequest & { sender?: string; recipient?: string },
    auth?: DownstreamAuthContext
  ): Promise<SwapPrepareResponse> {
    const res = await this.withRetry(() => this.http.post('/swap/prepare', request, this.buildRequestConfig(auth)));
    return this.normalizePrepareResponse(res.data);
  }

  private buildRequestConfig(auth?: DownstreamAuthContext): { headers?: Record<string, string> } | undefined {
    const token = auth?.bearerToken || this.fallbackAuthToken;
    if (!token) {
      return undefined;
    }
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }

  private normalizePrepareResponse(payload: any): SwapPrepareResponse {
    if (payload?.prepared) {
      const prepared = payload.prepared;
      const transactions = Array.isArray(prepared?.transactions)
        ? prepared.transactions.map((transaction: any) => this.normalizePreparedTransaction(transaction))
        : [];
      const metadataRoute =
        prepared?.metadata && typeof prepared.metadata === 'object'
          ? (prepared.metadata as Record<string, unknown>).route
          : undefined;

      const route =
        metadataRoute && typeof metadataRoute === 'object'
          ? { ...(metadataRoute as Record<string, unknown>), transactions }
          : { transactions };

      const txData =
        prepared?.txData ??
        (transactions.length === 1 ? transactions[0] : {});

      const estimatedOutput =
        prepared?.estimatedOutput ??
        prepared?.metadata?.quote?.amount ??
        prepared?.metadata?.quote?.output?.amount ??
        '';
      const expiresAt = this.normalizeExpiry(
        prepared?.expiresAt ??
        prepared?.metadata?.expiresAt ??
        prepared?.metadata?.quote?.expiresAt ??
        prepared?.metadata?.quoteResponse?.expiresAt ??
        prepared?.metadata?.quote?.quote?.expiresAt
      );
      const minOutput = this.normalizeOptionalString(
        prepared?.minOutput ??
        prepared?.metadata?.minOutput ??
        prepared?.metadata?.quote?.minAmount ??
        prepared?.metadata?.quote?.quote?.minAmount ??
        prepared?.metadata?.quoteResponse?.quote?.aggregatedOutputs?.[0]?.minAmount ??
        prepared?.metadata?.quote?.aggregatedOutputs?.[0]?.minAmount ??
        prepared?.metadata?.routing?.minAmountOut
      );
      const stale = typeof prepared?.stale === 'boolean'
        ? prepared.stale
        : expiresAt
          ? Date.parse(expiresAt) <= Date.now()
          : false;

      return {
        txData,
        estimatedOutput: String(estimatedOutput),
        route,
        provider: payload.provider ?? prepared?.provider,
        providerDebug:
          prepared?.metadata?.providerDebug && typeof prepared.metadata.providerDebug === 'object'
            ? prepared.metadata.providerDebug as Record<string, unknown>
            : undefined,
        expiresAt,
        minOutput,
        stale,
      };
    }

    return payload as SwapPrepareResponse;
  }

  private normalizeExpiry(value: unknown): string | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 10_000_000_000 ? value : value * 1000;
      const parsed = new Date(ms);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && /^\d+$/.test(value.trim())) {
        return this.normalizeExpiry(numericValue);
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }
    return undefined;
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    return String(value);
  }

  private normalizePreparedTransaction(transaction: any): Record<string, unknown> {
    if (!transaction || typeof transaction !== 'object') {
      return {};
    }
    return {
      ...transaction,
      feeMode: typeof transaction.feeMode === 'string' ? transaction.feeMode : 'advisory',
    };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === this.maxRetries) {
          break;
        }
        const delayMs = this.retryBackoffMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  private isRetryable(error: any): boolean {
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '');
    return (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      status === 429 ||
      status >= 500
    );
  }
}
