// Thirdweb Provider Adapter
// Wraps ThirdwebSwapAdapter to implement ISwapProvider interface
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from "../../domain/ports/swap.provider.port";
import { SwapRequest, SwapQuote, TransactionStatus } from "../../domain/entities/swap";
import { SwapError, SwapErrorCode } from "../../domain/entities/errors";
import { ThirdwebSwapAdapter } from "./thirdweb.swap.adapter";
import { isTokenSupported, resolveToken } from "../../config/tokens/registry";
import { sanitizePreparedTransactions } from "./transaction-filter";

/**
 * ThirdwebProviderAdapter
 *
 * Wraps the existing ThirdwebSwapAdapter to conform to the ISwapProvider interface.
 * This enables Thirdweb to work with the multi-provider routing system.
 *
 * Priority: Cross-chain swaps (Uniswap doesn't support cross-chain)
 */
export class ThirdwebProviderAdapter implements ISwapProvider {
  public readonly name = "thirdweb";

  private readonly thirdwebAdapter: ThirdwebSwapAdapter;

  constructor() {
    this.thirdwebAdapter = new ThirdwebSwapAdapter();
    console.log(`[ThirdwebProvider] Initialized`);
  }

  /**
   * Check if Thirdweb supports this route
   *
   * Thirdweb supports ALL routes (same-chain and cross-chain)
   * It's our fallback provider
   */
  async supportsRoute(params: RouteParams): Promise<boolean> {
    const fromSupported = isTokenSupported("thirdweb", params.fromChainId, params.fromToken);
    if (!fromSupported) {
      console.log(
        `[ThirdwebProvider] Token ${params.fromToken} not supported on chain ${params.fromChainId}`
      );
      return false;
    }

    const toSupported = isTokenSupported("thirdweb", params.toChainId, params.toToken);
    if (!toSupported) {
      console.log(
        `[ThirdwebProvider] Token ${params.toToken} not supported on chain ${params.toChainId}`
      );
      return false;
    }

    if (params.fromChainId === params.toChainId) {
      console.log("[ThirdwebProvider] Same-chain route supported via Thirdweb fallback");
    }

    return true;
  }

  /**
   * Get swap quote from Thirdweb Bridge
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    console.log("[ThirdwebProvider] Getting quote:", request.toLogString());
    resolveToken("thirdweb", request.fromChainId, request.fromToken);
    resolveToken("thirdweb", request.toChainId, request.toToken);
    return this.thirdwebAdapter.getQuote(request);
  }

  /**
   * Prepare swap transactions
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    console.log("[ThirdwebProvider] Preparing swap:", request.toLogString());

    resolveToken("thirdweb", request.fromChainId, request.fromToken);
    resolveToken("thirdweb", request.toChainId, request.toToken);

    const prepared = await this.thirdwebAdapter.prepareSwap(request);

    // Convert ThirdwebSwapAdapter response to PreparedSwap format
    const transactions: Transaction[] = [];
    const seenTransactionKeys = new Set<string>();

    const toTransactionKey = (tx: Transaction): string => JSON.stringify({
      chainId: tx.chainId,
      to: tx.to.toLowerCase(),
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      action: tx.action,
    });

    const pushTx = (tx: any) => {
      if (!tx) {
        return;
      }
      const normalizedTx: Transaction = {
        chainId: tx.chainId,
        to: tx.to,
        data: tx.data || "0x",
        value:
          typeof tx.value === "bigint"
            ? tx.value.toString()
            : tx.value ?? "0",
        gasLimit:
          typeof tx.gasLimit === "bigint"
            ? tx.gasLimit.toString()
            : tx.gasLimit,
        maxFeePerGas:
          typeof tx.maxFeePerGas === "bigint"
            ? tx.maxFeePerGas.toString()
            : tx.maxFeePerGas,
        maxPriorityFeePerGas:
          typeof tx.maxPriorityFeePerGas === "bigint"
            ? tx.maxPriorityFeePerGas.toString()
            : tx.maxPriorityFeePerGas,
        feeMode: "advisory",
        action: tx.action,
        description: tx.description,
      };
      const key = toTransactionKey(normalizedTx);
      if (seenTransactionKeys.has(key)) {
        return;
      }
      seenTransactionKeys.add(key);
      transactions.push(normalizedTx);
    };

    if (Array.isArray(prepared.transactions)) {
      for (const tx of prepared.transactions) {
        pushTx(tx);
      }
    }

    if (Array.isArray(prepared.steps)) {
      for (const step of prepared.steps) {
        if (Array.isArray(step?.transactions)) {
          for (const tx of step.transactions) {
            pushTx(tx);
          }
        }
      }
    }

    const { executable, discarded } = sanitizePreparedTransactions(
      transactions,
      request.fromChainId
    );

    if (discarded.length > 0) {
      console.log("[ThirdwebProvider] Skipping non-origin chain transactions", {
        originChainId: request.fromChainId,
        discardedChains: Array.from(new Set(discarded.map((tx) => tx.chainId))),
      });
    }

    if (executable.length === 0) {
      throw new SwapError(
        SwapErrorCode.PROVIDER_ERROR,
        "Thirdweb returned no executable transactions for the origin chain",
        {
          originChainId: request.fromChainId,
          returnedChains: Array.from(new Set(transactions.map((tx) => tx.chainId))),
        },
        502
      );
    }

    if (transactions.length === 0) {
      console.warn("[ThirdwebProvider] ⚠️ No transactions returned by thirdweb prepare", {
        steps: prepared.steps?.length ?? 0,
        hasTopLevelTransactions: Array.isArray(prepared.transactions),
      });
    }

    return {
      provider: this.name,
      transactions: executable,
      estimatedDuration: Math.floor(
        (prepared.estimatedExecutionTimeMs ?? 60_000) / 1000
      ),
      expiresAt: prepared.expiration
        ? new Date(
            typeof prepared.expiration === "string"
              ? Number(prepared.expiration)
              : prepared.expiration
          )
        : undefined,
        metadata: {
          bridgeQuoteId: prepared.bridgeQuoteId,
          raw: prepared,
          discardedTransactions: discarded,
        },
    };
  }

  /**
   * Monitor transaction status
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> {
    console.log("[ThirdwebProvider] Monitoring transaction:", txHash);
    const statusString = await this.thirdwebAdapter.monitorTransaction(txHash, chainId);

    // Map string status to TransactionStatus enum
    switch (statusString.toLowerCase()) {
      case 'completed':
      case 'success':
        return TransactionStatus.COMPLETED;
      case 'failed':
      case 'error':
        return TransactionStatus.FAILED;
      case 'pending':
      default:
        return TransactionStatus.PENDING;
    }
  }
}
