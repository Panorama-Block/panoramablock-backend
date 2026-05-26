// Trader Joe Provider Adapter
// Calls PanoramaBlock Execution Service to route swaps through Trader Joe on Avalanche
import type { ProviderMetadata } from "@panorama/capability";
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from "../../domain/ports/swap.provider.port";
import { SwapRequest, SwapQuote, TransactionStatus } from "../../domain/entities/swap";
import { SwapError, SwapErrorCode } from "../../domain/entities/errors";
import axios, { AxiosInstance } from "axios";

const AVAX_CHAIN_ID = 43114;

export class TraderJoeProviderAdapter implements ISwapProvider {
  public readonly name = "traderjoe";
  public readonly metadata: ProviderMetadata = {
    name: "traderjoe",
    capability: "swap",
    supportedChains: [AVAX_CHAIN_ID],
    features: ["same-chain", "liquidity-book", "v2.1"],
    version: "1.0.0",
    enabled: true,
  };

  private readonly client: AxiosInstance;

  constructor() {
    const base = process.env.EXECUTION_SERVICE_URL || process.env.EXECUTION_LAYER_URL || "http://localhost:3010";
    const baseURL = `${base.replace(/\/+$/, "")}/avax/swap`;
    this.client = axios.create({
      baseURL,
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
    });
  }

  async supportsRoute(params: RouteParams): Promise<boolean> {
    return (
      params.fromChainId === AVAX_CHAIN_ID &&
      params.toChainId === AVAX_CHAIN_ID
    );
  }

  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    try {
      const response = await this.client.post("/quote", {
        tokenIn: request.fromToken,
        tokenOut: request.toToken,
        amountIn: request.amount.toString(),
        chainId: AVAX_CHAIN_ID,
      });

      const data = response.data;
      return new SwapQuote(
        BigInt(data.amountOut || data.estimatedReceiveAmount || "0"),
        BigInt(0),
        BigInt(data.gasFee || "0"),
        Number(data.exchangeRate || 1),
        data.estimatedDuration || 15
      );
    } catch (error) {
      throw new SwapError(
        SwapErrorCode.QUOTE_FAILED,
        `Trader Joe quote failed: ${(error as Error).message}`,
        "traderjoe"
      );
    }
  }

  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    try {
      const response = await this.client.post("/prepare", {
        tokenIn: request.fromToken,
        tokenOut: request.toToken,
        amountIn: request.amount.toString(),
        sender: request.sender,
        receiver: request.receiver,
        chainId: AVAX_CHAIN_ID,
        slippageBps: 50,
      });

      const data = response.data;
      const transactions: Transaction[] = (data.transactions || []).map(
        (tx: any) => ({
          chainId: AVAX_CHAIN_ID,
          to: tx.to,
          data: tx.data,
          value: tx.value || "0",
          gasLimit: tx.gasLimit,
          action: tx.action,
          description: tx.description,
        })
      );

      return {
        provider: this.name,
        transactions,
        estimatedDuration: data.estimatedDuration || 15,
        metadata: { protocol: "traderjoe", version: "v2.1" },
      };
    } catch (error) {
      throw new SwapError(
        SwapErrorCode.SWAP_FAILED,
        `Trader Joe prepare failed: ${(error as Error).message}`,
        "traderjoe"
      );
    }
  }

  async monitorTransaction(
    txHash: string,
    chainId: number
  ): Promise<TransactionStatus> {
    if (chainId !== AVAX_CHAIN_ID) return TransactionStatus.FAILED;
    try {
      const response = await this.client.get(`/status/${txHash}`);
      return response.data?.status || TransactionStatus.PENDING;
    } catch {
      return TransactionStatus.PENDING;
    }
  }
}
