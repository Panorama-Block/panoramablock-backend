// Infrastructure Adapters (non-custodial V1) - Using REST API directly
import { createThirdwebClient, Bridge } from "thirdweb";
import axios from "axios";
import { utils as ethersUtils } from "ethers";
import {
  SwapRequest,
  SwapQuote,
  SwapResult,
  SwapTransaction,
  TransactionStatus,
} from "../../domain/entities/swap";
import { ISwapService } from "../../domain/ports/swap.repository";
import { resolveToken } from "../../config/tokens/registry";
import { mapThirdwebError, mapThirdwebStatusError } from "./thirdweb.error.mapper";

const BRIDGE_API = "https://bridge.thirdweb.com/v1";
const THIRDWEB_NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function normalizeThirdwebAddress(address: string): string {
  return ethersUtils.getAddress(address.toLowerCase());
}

function normalizeThirdwebTokenIdentifier(
  identifier: string,
  isNative: boolean
): string {
  if (isNative) {
    return THIRDWEB_NATIVE_TOKEN_ADDRESS;
  }
  return normalizeThirdwebAddress(identifier);
}

/**
 * Fix EIP-1559 gas parameters if they are invalid.
 * ThirdWeb sometimes returns maxPriorityFeePerGas > maxFeePerGas which is invalid.
 * This function ensures maxFeePerGas >= maxPriorityFeePerGas.
 */
function fixGasParams(tx: any): any {
  if (!tx || typeof tx !== 'object') return tx;

  const maxFeePerGas = tx.maxFeePerGas;
  const maxPriorityFeePerGas = tx.maxPriorityFeePerGas;

  // Only fix if both are present and maxPriorityFeePerGas > maxFeePerGas
  if (maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined) {
    const maxFee = BigInt(maxFeePerGas);
    const priorityFee = BigInt(maxPriorityFeePerGas);

    if (priorityFee > maxFee) {
      console.warn(
        `[ThirdwebSwapAdapter] Fixing invalid gas params: maxFeePerGas (${maxFee}) < maxPriorityFeePerGas (${priorityFee})`
      );
      // Set maxFeePerGas to priorityFee + 20% buffer for base fee fluctuation
      const fixedMaxFee = priorityFee + (priorityFee / 5n);
      return {
        ...tx,
        maxFeePerGas: fixedMaxFee.toString(),
      };
    }
  }

  return tx;
}

/**
 * Fix gas parameters for all transactions in the prepare response
 */
function fixPrepareResponseGasParams(data: any): any {
  if (!data) return data;

  // Handle steps array (ThirdWeb prepare response structure)
  if (data.steps && Array.isArray(data.steps)) {
    return {
      ...data,
      steps: data.steps.map((step: any) => {
        if (step.transactions && Array.isArray(step.transactions)) {
          return {
            ...step,
            transactions: step.transactions.map(fixGasParams),
          };
        }
        return step;
      }),
    };
  }

  // Handle direct transactions array
  if (data.transactions && Array.isArray(data.transactions)) {
    return {
      ...data,
      transactions: data.transactions.map(fixGasParams),
    };
  }

  return data;
}

export class ThirdwebSwapAdapter implements ISwapService {
  private client: ReturnType<typeof createThirdwebClient>;
  private clientId: string;
  private secretKey?: string;

  constructor() {
    const clientId = process.env.THIRDWEB_CLIENT_ID;
    const secretKey = process.env.THIRDWEB_SECRET_KEY;

    console.log("[ThirdwebSwapAdapter] Initializing with credentials:");
    console.log(
      "- CLIENT_ID:",
      clientId ? `${clientId.substring(0, 8)}...` : "[NOT SET]"
    );
    console.log("- SECRET_KEY:", secretKey ? "[SET]" : "[NOT SET]");

    if (!clientId) {
      throw new Error("THIRDWEB_CLIENT_ID is required");
    }

    this.clientId = clientId;
    this.secretKey = secretKey;

    this.client = createThirdwebClient({
      clientId,
      ...(secretKey ? { secretKey } : {}),
    });

    console.log(
      "[ThirdwebSwapAdapter] Initialized successfully (REST API mode)"
    );
  }

  public async getQuote(swapRequest: SwapRequest): Promise<SwapQuote> {
    try {
      console.log(
        "[ThirdwebSwapAdapter] Getting quote for:",
        swapRequest.toLogString()
      );

      const originToken = resolveToken("thirdweb", swapRequest.fromChainId, swapRequest.fromToken);
      const destinationToken = resolveToken("thirdweb", swapRequest.toChainId, swapRequest.toToken);
      const originTokenAddress = normalizeThirdwebTokenIdentifier(
        originToken.identifier,
        originToken.isNative
      );
      const destinationTokenAddress = normalizeThirdwebTokenIdentifier(
        destinationToken.identifier,
        destinationToken.isNative
      );

      console.log("[ThirdwebSwapAdapter] Resolved tokens:", {
        origin: {
          identifier: originTokenAddress,
          rawIdentifier: originToken.identifier,
          isNative: originToken.isNative,
          address: originToken.metadata.address,
          symbol: originToken.metadata.symbol,
        },
        destination: {
          identifier: destinationTokenAddress,
          rawIdentifier: destinationToken.identifier,
          isNative: destinationToken.isNative,
          address: destinationToken.metadata.address,
          symbol: destinationToken.metadata.symbol,
        },
      });

      const sellAmountWei = swapRequest.amount;

      // Use REST API directly (SDK has bugs for certain chain pairs)
      const response = await axios.get(`${BRIDGE_API}/sell/quote`, {
        params: {
          originChainId: swapRequest.fromChainId,
          originTokenAddress,
          destinationChainId: swapRequest.toChainId,
          destinationTokenAddress,
          sellAmountWei: sellAmountWei.toString(),
          amount: sellAmountWei.toString(),
        },
        headers: {
          "x-client-id": this.clientId,
          ...(this.secretKey ? { "x-secret-key": this.secretKey } : {}),
        },
      });

      const quote = response.data.data;
      const originAmount = BigInt(quote.originAmount.toString());
      const destAmount = BigInt(quote.destinationAmount.toString());
      const estMs = quote.estimatedExecutionTimeMs ?? 60_000;

      // Decimals-aware exchangeRate: (destHuman / originHuman)
      const fromDecimals = originToken.metadata.decimals;
      const toDecimals = destinationToken.metadata.decimals;

      // rate = destWei * 10^fromDecimals / (originWei * 10^toDecimals)
      const SCALE = 12n; // 12 decimal places of precision
      const num = destAmount * (10n ** (BigInt(fromDecimals) + SCALE));
      const den = originAmount * (10n ** BigInt(toDecimals));
      const scaledRate = den === 0n ? 0n : (num / den);
      const exchangeRate = Number(scaledRate) / 10 ** Number(SCALE);

      if (process.env.DEBUG === "true") {
        console.log("[ThirdwebSwapAdapter] Quote breakdown:", {
          originAmount: originAmount.toString(),
          destAmount: destAmount.toString(),
          fromDecimals,
          toDecimals,
          exchangeRate,
        });
      }

      // Keep gas fee as small placeholder (TODO: replace when provider exposes it)
      const estimatedGasFee = BigInt("420000000000000"); // ~0.00042 ETH em wei

      return new SwapQuote(
        destAmount,
        0n, // bridgeFee unknown across assets; do not infer from origin-dest difference
        estimatedGasFee,
        exchangeRate,
        Math.floor(estMs / 1000)
      );
    } catch (error: unknown) {
      throw mapThirdwebError(error, 'getQuote');
    }
  }


  public async prepareSwap(swapRequest: SwapRequest): Promise<any> {
    try {
      const originToken = resolveToken("thirdweb", swapRequest.fromChainId, swapRequest.fromToken);
      const destinationToken = resolveToken("thirdweb", swapRequest.toChainId, swapRequest.toToken);
      const originTokenAddress = normalizeThirdwebTokenIdentifier(
        originToken.identifier,
        originToken.isNative
      );
      const destinationTokenAddress = normalizeThirdwebTokenIdentifier(
        destinationToken.identifier,
        destinationToken.isNative
      );
      const sender = normalizeThirdwebAddress(swapRequest.sender);
      const receiver = normalizeThirdwebAddress(
        swapRequest.receiver || swapRequest.sender
      );

      const payload = {
        originChainId: swapRequest.fromChainId.toString(),
        originTokenAddress,
        destinationChainId: swapRequest.toChainId.toString(),
        destinationTokenAddress,
        amount: swapRequest.amount.toString(),
        sellAmountWei: swapRequest.amount.toString(),
        sender,
        receiver,
      };

      console.log("[ThirdwebSwapAdapter] Prepare payload:", payload);

      // Use REST API directly (SDK has bugs for certain chain pairs)
      const response = await axios.post(`${BRIDGE_API}/sell/prepare`, payload, {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": this.clientId,
          ...(this.secretKey ? { "x-secret-key": this.secretKey } : {}),
        },
      });

      // Response contains { steps: [{ transactions: [...] }], expiresAt, ... }
      // Fix invalid gas parameters before returning (ThirdWeb bug workaround)
      console.log("[ThirdwebSwapAdapter] Raw response from ThirdWeb:", JSON.stringify(response.data.data, null, 2));
      const fixedData = fixPrepareResponseGasParams(response.data.data);
      console.log("[ThirdwebSwapAdapter] Fixed response:", JSON.stringify(fixedData, null, 2));
      return fixedData;
    } catch (error: unknown) {
      throw mapThirdwebError(error, 'prepareSwap');
    }
  }

  /**
   * DESABILITADO no V1 non-custodial.
   * Mantido apenas para compatibilidade com interfaces.
   */
  public async executeSwap(_swapRequest: SwapRequest): Promise<SwapResult> {
    throw new Error(
      "Server-side execution is disabled in non-custodial V1. Use prepareSwap() on server and send/sign on the client."
    );
  }

  public async monitorTransaction(
    transactionHash: string,
    chainId: number
  ): Promise<string> {
    try {
      const status = await Bridge.status({
        transactionHash: transactionHash as `0x${string}`,
        chainId,
        client: this.client,
      });

      switch (status.status) {
        case "COMPLETED":
          return TransactionStatus.COMPLETED;
        case "PENDING":
          return TransactionStatus.PENDING;
        case "FAILED":
          return TransactionStatus.FAILED;
        default:
          return TransactionStatus.PENDING;
      }
    } catch (error: unknown) {
      throw mapThirdwebStatusError(error, transactionHash);
    }
  }

  // Métodos auxiliares mockados mantidos
  public async getSupportedChains(): Promise<any[]> {
    const supportedChains = [
      {
        chainId: 1,
        name: "Ethereum",
        icon: "",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      {
        chainId: 137,
        name: "Polygon",
        icon: "",
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      },
      {
        chainId: 56,
        name: "BSC",
        icon: "",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      },
      {
        chainId: 8453,
        name: "Base",
        icon: "",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      {
        chainId: 10,
        name: "Optimism",
        icon: "",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      {
        chainId: 42161,
        name: "Arbitrum",
        icon: "",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      {
        chainId: 43114,
        name: "Avalanche",
        icon: "",
        nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      },
    ];
    console.log(
      `[ThirdwebSwapAdapter] Returning ${supportedChains.length} supported chains`
    );
    return supportedChains;
  }

  public async getSupportedRoutes(
    _originChainId?: number,
    _destinationChainId?: number
  ): Promise<any[]> {
    const mockRoutes = [
      {
        originToken: {
          chainId: 1,
          address: "native",
          symbol: "ETH",
          name: "Ethereum",
          decimals: 18,
        },
        destinationToken: {
          chainId: 137,
          address: "native",
          symbol: "MATIC",
          name: "Polygon",
          decimals: 18,
        },
      },
      {
        originToken: {
          chainId: 137,
          address: "native",
          symbol: "MATIC",
          name: "Polygon",
          decimals: 18,
        },
        destinationToken: {
          chainId: 1,
          address: "native",
          symbol: "ETH",
          name: "Ethereum",
          decimals: 18,
        },
      },
    ];
    console.log(
      `[ThirdwebSwapAdapter] Returning ${mockRoutes.length} supported routes`
    );
    return mockRoutes;
  }
}
