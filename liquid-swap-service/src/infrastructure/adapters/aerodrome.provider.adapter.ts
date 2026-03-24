// Aerodrome Provider Adapter
// Calls PanoramaBlock Execution Service to route swaps through Aerodrome on Base
import { ISwapProvider, RouteParams, PreparedSwap, Transaction } from "../../domain/ports/swap.provider.port";
import { SwapRequest, SwapQuote, TransactionStatus } from "../../domain/entities/swap";
import { SwapError, SwapErrorCode } from "../../domain/entities/errors";
import axios, { AxiosInstance } from "axios";

const BASE_CHAIN_ID = 8453;

/**
 * AerodromeProviderAdapter
 *
 * Implements ISwapProvider by calling the PanoramaBlock Execution Service,
 * which routes swaps through Aerodrome Finance on Base.
 *
 * Only supports same-chain swaps on Base (chainId 8453).
 * Aerodrome is the dominant DEX on Base with deep liquidity for AERO pairs,
 * stable pools, and tokens not available on Uniswap.
 */
export class AerodromeProviderAdapter implements ISwapProvider {
  public readonly name = "aerodrome";

  private readonly client: AxiosInstance;

  constructor() {
    const base = process.env.EXECUTION_SERVICE_URL || process.env.EXECUTION_LAYER_URL || "http://localhost:3010";
    // As rotas do swap-provider na execution-layer estão montadas em /provider/swap
    const baseURL = `${base.replace(/\/+$/, "")}/provider/swap`;
    this.client = axios.create({
      baseURL,
      timeout: 45000,
      headers: { "Content-Type": "application/json" },
    });
    console.log(`[⛽ AERODROME] Inicializado — Execution Layer em: ${baseURL}`);
  }

  /**
   * Check if Aerodrome supports this route.
   * Only supports same-chain Base swaps where an Aerodrome pool exists.
   */
  async supportsRoute(params: RouteParams): Promise<boolean> {
    if (params.fromChainId !== BASE_CHAIN_ID || params.toChainId !== BASE_CHAIN_ID) {
      return false;
    }

    const url = `${this.client.defaults.baseURL}/swap/supports`;
    console.log(`[⛽ AERODROME] → supportsRoute — chamando Execution Layer`);
    console.log(`[⛽ AERODROME]   URL    : POST ${url}`);
    console.log(`[⛽ AERODROME]   Par    : ${params.fromToken} → ${params.toToken}`);

    try {
      const response = await this.client.post("/supports", {
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
      });

      const supported = response.data?.supported === true;
      const reason = response.data?.reason || "";
      console.log(`[⛽ AERODROME] ← supportsRoute: ${supported ? "✅ suportado" : `❌ não suportado${reason ? ` (${reason})` : ""}`}`);
      return supported;
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status} — ${error.response?.data?.error || error.message}`
        : (error as Error).message;
      console.warn(`[⛽ AERODROME] ← supportsRoute ERRO: ${msg}`);
      return false;
    }
  }

  /**
   * Get swap quote from Aerodrome via Execution Service.
   * Automatically picks the best pool type (volatile vs stable).
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    const url = `${this.client.defaults.baseURL}/swap/quote`;
    console.log(`[⛽ AERODROME] → getQuote — chamando Execution Layer`);
    console.log(`[⛽ AERODROME]   URL    : POST ${url}`);
    console.log(`[⛽ AERODROME]   Par    : ${request.fromToken} → ${request.toToken}`);
    console.log(`[⛽ AERODROME]   Amount : ${request.amount.toString()} wei`);
    console.log(`[⛽ AERODROME]   Sender : ${request.sender}`);

    try {
      const response = await this.client.post("/quote", {
        fromToken: request.fromToken,
        toToken: request.toToken,
        amount: request.amount.toString(),
        sender: request.sender,
      });

      const data = response.data;
      console.log(`[⛽ AERODROME] ← getQuote OK`);
      console.log(`[⛽ AERODROME]   amountOut   : ${data.estimatedReceiveAmount}`);
      console.log(`[⛽ AERODROME]   exchangeRate: ${data.exchangeRate}`);
      console.log(`[⛽ AERODROME]   stable pool : ${data.stable}`);

      return new SwapQuote(
        BigInt(data.estimatedReceiveAmount),
        BigInt(data.bridgeFee || "0"),
        BigInt(data.gasFee || "0"),
        data.exchangeRate || 0,
        data.estimatedDuration || 15
      );
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status} — ${error.response?.data?.error || error.message}`
        : (error as Error).message;
      console.error(`[⛽ AERODROME] ← getQuote ERRO: ${msg}`);
      throw new SwapError(
        SwapErrorCode.PROVIDER_ERROR,
        `Aerodrome quote failed: ${msg}`,
        { provider: this.name, originalError: msg }
      );
    }
  }

  /**
   * Prepare swap transactions (approval + swap) for user signature.
   * Returns transactions targeting PanoramaExecutor on Base.
   */
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> {
    const url = `${this.client.defaults.baseURL}/swap/prepare`;
    console.log(`[⛽ AERODROME] → prepareSwap — chamando Execution Layer`);
    console.log(`[⛽ AERODROME]   URL      : POST ${url}`);
    console.log(`[⛽ AERODROME]   Par      : ${request.fromToken} → ${request.toToken}`);
    console.log(`[⛽ AERODROME]   Amount   : ${request.amount.toString()} wei`);
    console.log(`[⛽ AERODROME]   Sender   : ${request.sender}`);
    console.log(`[⛽ AERODROME]   Receiver : ${request.receiver}`);

    try {
      const response = await this.client.post("/prepare", {
        fromToken: request.fromToken,
        toToken: request.toToken,
        amount: request.amount.toString(),
        sender: request.sender,
        receiver: request.receiver,
      });

      const data = response.data;
      const transactions: Transaction[] = (data.transactions || []).map(
        (tx: any) => ({
          chainId: tx.chainId || BASE_CHAIN_ID,
          to: tx.to,
          data: tx.data || "0x",
          value: typeof tx.value === "bigint" ? tx.value.toString() : tx.value || "0",
          action: tx.description?.includes("Approve") ? "approval" : "swap",
          description: tx.description,
        })
      );

      console.log(`[⛽ AERODROME] ← prepareSwap OK`);
      console.log(`[⛽ AERODROME]   Txs geradas : ${transactions.length}`);
      transactions.forEach((tx, i) => {
        console.log(`[⛽ AERODROME]   [${i + 1}] ${tx.description || tx.action} → to: ${tx.to}`);
      });
      console.log(`[⛽ AERODROME]   Executor    : ${data.metadata?.executor}`);
      console.log(`[⛽ AERODROME]   Stable pool : ${data.metadata?.stable}`);

      return {
        provider: this.name,
        transactions,
        estimatedDuration: data.estimatedDuration || 15,
        metadata: {
          protocol: "aerodrome",
          executor: data.metadata?.executor,
          stable: data.metadata?.stable,
        },
      };
    } catch (error) {
      const serverMsg = axios.isAxiosError(error) ? (error.response?.data?.error || '') : '';
      const msg = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status} — ${serverMsg || (error as Error).message}`
        : (error as Error).message;
      console.error(`[⛽ AERODROME] ← prepareSwap ERRO: ${msg}`);

      // Map known execution-layer business errors to proper SwapError codes
      if (serverMsg.toLowerCase().includes('insufficient token balance') || serverMsg.toLowerCase().includes('insufficient balance')) {
        throw new SwapError(
          SwapErrorCode.INSUFFICIENT_BALANCE,
          `Insufficient balance to complete the swap. ${serverMsg}`,
          { provider: this.name, originalError: msg }
        );
      }

      if (serverMsg.toLowerCase().includes('no liquidity available on aerodrome')) {
        throw new SwapError(
          SwapErrorCode.NO_ROUTE_FOUND,
          'No liquidity available for this token pair on Aerodrome. Try a different pair.',
          { provider: this.name, originalError: msg }
        );
      }

      if (serverMsg.toLowerCase().includes('rpc error fetching pool quotes')) {
        throw new SwapError(
          SwapErrorCode.RPC_ERROR,
          'Network connection issue. Please try again.',
          { provider: this.name, originalError: msg }
        );
      }

      // 0x7939f424 = InsufficientOutputAmount() — Aerodrome pool revert when amountOut < amountOutMin
      // This is a slippage failure, not an RPC/network issue.
      const INSUFFICIENT_OUTPUT_SELECTOR = '0x7939f424';
      const isSlippageRevert =
        serverMsg.includes(INSUFFICIENT_OUTPUT_SELECTOR) ||
        serverMsg.toLowerCase().includes('insufficientoutputamount') ||
        serverMsg.toLowerCase().includes('insufficient output amount') ||
        serverMsg.toLowerCase().includes('amountoutlessthanmin') ||
        serverMsg.toLowerCase().includes('amount out less than min');

      if (isSlippageRevert) {
        throw new SwapError(
          SwapErrorCode.SLIPPAGE_TOO_HIGH,
          'Price moved too much since the quote. Please try again for an updated price.',
          { provider: this.name, originalError: msg, selector: INSUFFICIENT_OUTPUT_SELECTOR }
        );
      }

      if (serverMsg.toLowerCase().includes('missing revert data') || serverMsg.toLowerCase().includes('network error')) {
        throw new SwapError(
          SwapErrorCode.RPC_ERROR,
          'Network connection issue. Please try again.',
          { provider: this.name, originalError: msg }
        );
      }

      // Generic call_exception that is NOT a known slippage revert → RPC_ERROR
      if (serverMsg.toLowerCase().includes('call_exception')) {
        throw new SwapError(
          SwapErrorCode.RPC_ERROR,
          'Network connection issue. Please try again.',
          { provider: this.name, originalError: msg }
        );
      }

      throw new SwapError(
        SwapErrorCode.PROVIDER_ERROR,
        `Aerodrome prepare failed: ${msg}`,
        { provider: this.name, originalError: msg }
      );
    }
  }

  /**
   * Monitor transaction status on Base via RPC.
   */
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> {
    if (chainId !== BASE_CHAIN_ID) {
      return TransactionStatus.FAILED;
    }

    try {
      const { ethers } = await import("ethers");
      const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) return TransactionStatus.PENDING;
      return receipt.status === 1 ? TransactionStatus.COMPLETED : TransactionStatus.FAILED;
    } catch {
      return TransactionStatus.PENDING;
    }
  }
}
