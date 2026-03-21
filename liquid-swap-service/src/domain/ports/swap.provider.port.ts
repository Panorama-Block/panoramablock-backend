// Domain Port - Generic Swap Provider Interface
// This port enables multiple swap providers (Uniswap, Thirdweb, etc.) with dependency inversion
import { SwapRequest, SwapQuote, TransactionStatus } from "../entities/swap";

/**
 * RouteParams
 *
 * Parameters to check if a provider supports a specific swap route
 */
export interface RouteParams {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
}

/**
 * Transaction
 *
 * Represents a prepared blockchain transaction ready to be signed by the user
 */
export interface Transaction {
  chainId: number;
  to: string;
  data: string;
  value: string; // Wei as string (BigInt serialized)
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  feeMode?: 'authoritative' | 'advisory';
  action?: string;
  description?: string;
}

/**
 * PreparedSwap
 *
 * Result of preparing a swap with all transactions ready for user signature
 */
export interface PreparedSwap {
  provider: string; // Name of the provider used ('uniswap', 'thirdweb', etc.)
  transactions: Transaction[]; // Transactions to sign (approval + swap, or just swap)
  estimatedDuration: number; // Estimated time in seconds
  expiresAt?: Date; // When the prepared swap expires (if applicable)
  metadata?: Record<string, any>; // Provider-specific data
}

/**
 * ISwapProvider
 *
 * Generic interface that all swap providers must implement.
 * Enables the router to use any provider transparently.
 *
 * @example
 * ```typescript
 * class UniswapProvider implements ISwapProvider {
 *   readonly name = 'uniswap';
 *
 *   async supportsRoute(params: RouteParams): Promise<boolean> {
 *     // Check if Uniswap can handle this route
 *     return params.fromChainId === params.toChainId;
 *   }
 *
 *   async getQuote(request: SwapRequest): Promise<SwapQuote> {
 *     // Call Uniswap API and return quote
 *   }
 * }
 * ```
 */
export interface ISwapProvider {
  /**
   * Provider identifier
   *
   * @example 'uniswap', 'thirdweb', '1inch'
   */
  readonly name: string;

  /**
   * Check if this provider supports a given swap route
   *
   * This method should:
   * - Check if both chains are supported
   * - Check if the swap type (same-chain vs cross-chain) is supported
   * - Return false if provider is disabled or has no API keys
   *
   * @param params - Route parameters (chains and tokens)
   * @returns true if provider can handle this route
   *
   * @example
   * ```typescript
   * // Uniswap only supports same-chain
   * await provider.supportsRoute({
   *   fromChainId: 1,
   *   toChainId: 1, // same chain
   *   fromToken: 'USDC',
   *   toToken: 'ETH'
   * }); // returns true
   *
   * await provider.supportsRoute({
   *   fromChainId: 1,
   *   toChainId: 137, // cross-chain
   *   fromToken: 'USDC',
   *   toToken: 'USDC'
   * }); // returns false (Uniswap doesn't do bridges)
   * ```
   */
  supportsRoute(params: RouteParams): Promise<boolean>;

  /**
   * Get a quote for a swap
   *
   * This method should:
   * - Call the provider's API/SDK to get swap quote
   * - Parse response into domain SwapQuote entity
   * - Calculate accurate gas fees
   * - Return estimated receive amount
   *
   * @param request - Swap request with all parameters
   * @returns SwapQuote with estimated amounts and fees
   *
   * @throws Error if quote fails (no liquidity, unsupported token, etc.)
   *
   * @example
   * ```typescript
   * const quote = await provider.getQuote(swapRequest);
   * console.log('Estimated receive:', quote.estimatedReceiveAmount);
   * console.log('Gas fee:', quote.gasFee);
   * ```
   */
  getQuote(request: SwapRequest): Promise<SwapQuote>;

  /**
   * Prepare swap transactions for user signature
   *
   * This method should:
   * - Get fresh quote (don't reuse old ones)
   * - Check if approvals are needed
   * - Build all necessary transactions (approval + swap)
   * - Return transaction data ready for signing
   *
   * @param request - Swap request with all parameters
   * @returns PreparedSwap with transactions and metadata
   *
   * @throws Error if preparation fails
   * @throws Error('APPROVAL_REQUIRED') if token approval needed
   * @throws Error('PERMIT2_SIGNATURE_REQUIRED') if Permit2 signature needed (Uniswap)
   *
   * @example
   * ```typescript
   * const prepared = await provider.prepareSwap(swapRequest);
   *
   * // Sign each transaction
   * for (const tx of prepared.transactions) {
   *   const signedTx = await signer.sendTransaction(tx);
   *   await signedTx.wait();
   * }
   * ```
   */
  prepareSwap(request: SwapRequest): Promise<PreparedSwap>;

  /**
   * Monitor transaction status
   *
   * This method should:
   * - For on-chain transactions: query RPC for TX status
   * - For orders (UniswapX): query order status API
   * - Return current status
   *
   * @param txHash - Transaction hash or order ID
   * @param chainId - Chain where transaction was sent
   * @returns Transaction status (PENDING, CONFIRMED, COMPLETED, FAILED)
   *
   * @example
   * ```typescript
   * const status = await provider.monitorTransaction('0x123...', 1);
   * if (status === TransactionStatus.COMPLETED) {
   *   console.log('Swap completed!');
   * }
   * ```
   */
  monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus>;
}
