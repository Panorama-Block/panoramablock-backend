/**
 * Swap Service
 * Executes token swaps using Thirdweb SDK and Uniswap V3
 */

import { QuoteService } from './quote.service';
import { CircuitBreakerManager, CIRCUIT_BREAKERS } from './circuitBreaker.service';
import { WETH_ADDRESS, SWAP_DEADLINE_SECONDS, MAX_SLIPPAGE_PERCENT } from '../config/swap.config';
import { AuditLogger, AuditEventType } from './auditLog.service';

export interface SwapParams {
  smartAccountAddress: string;
  sessionKey: string;
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  userId?: string; // For audit logging
}

export interface SwapResult {
  txHash: string;
  amountIn: string;
  amountOut: string;
  gasUsed?: string;
}

/**
 * Swap Service
 * Handles token swap execution with security features
 */
// Chains supported by Uniswap V3 (Smart Account DCA)
const SUPPORTED_CHAINS = new Set([1, 5, 137, 42161, 10, 8453]);

export class SwapService {
  private quoteService = new QuoteService();
  private auditLogger = AuditLogger.getInstance();

  private getCircuitBreaker(chainId: number) {
    return CircuitBreakerManager.getBreaker(`${CIRCUIT_BREAKERS.UNISWAP_ROUTER}-${chainId}`, {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000,
      monitoringWindow: 300000,
    });
  }

  /**
   * Execute a token swap
   * @param params Swap parameters
   * @returns Swap result with transaction hash
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    console.log('[SwapService] 🔄 Preparing swap transaction...');
    console.log('[SwapService] From:', params.fromToken);
    console.log('[SwapService] To:', params.toToken);
    console.log('[SwapService] Amount:', params.amount);
    console.log('[SwapService] Chain:', params.fromChainId);

    // Audit log: Swap initiated
    await this.auditLogger.log({
      eventType: AuditEventType.SWAP_INITIATED,
      userId: params.userId || params.smartAccountAddress,
      metadata: {
        smartAccountAddress: params.smartAccountAddress,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount,
        chainId: params.fromChainId,
      },
    });

    // Validate strategy data before hitting circuit breaker
    if (params.fromToken.toLowerCase() === params.toToken.toLowerCase()) {
      throw new Error(`Invalid strategy: fromToken and toToken are the same (${params.fromToken})`);
    }
    if (!SUPPORTED_CHAINS.has(params.fromChainId)) {
      throw new Error(`Chain ${params.fromChainId} is not supported by Uniswap V3 smart account DCA`);
    }

    // Use per-chain circuit breaker so one chain's failures don't block others
    return this.getCircuitBreaker(params.fromChainId).execute(async () => {
      try {
        // Import Thirdweb functions
        const { createThirdwebClient, getContract } = await import('thirdweb');
        const { defineChain } = await import('thirdweb/chains');
        const { privateKeyToAccount, smartWallet } = await import('thirdweb/wallets');
        const { prepareContractCall, sendTransaction, toWei } = await import('thirdweb');
        const { approve, allowance: getAllowance } = await import('thirdweb/extensions/erc20');

        // 1. Initialize Thirdweb client
        const client = createThirdwebClient({
          secretKey: process.env.THIRDWEB_SECRET_KEY!,
        });

        const chain = defineChain(params.fromChainId);

        console.log('[SwapService] ✅ Thirdweb client initialized');

        // 2. Create personal account from session key
        const personalAccount = privateKeyToAccount({
          client,
          privateKey: params.sessionKey,
        });

        // 3. Connect to smart wallet
        const wallet = smartWallet({
          chain,
          gasless: false,
          sponsorGas: false,
        });

        const smartAccount = await wallet.connect({
          client,
          personalAccount,
        });

        console.log('[SwapService] ✅ Connected to smart account:', smartAccount.address);

        // 4. Check if we need to swap native ETH or ERC20 token
        const isNativeToken = params.fromToken === '0x0000000000000000000000000000000000000000' ||
                             params.fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

        const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

        if (isNativeToken) {
          // Native ETH swap
          console.log('[SwapService] 💎 Swapping native ETH');

          const swapRouterContract = getContract({
            client,
            chain,
            address: SWAP_ROUTER_ADDRESS,
          });

          const amountInWei = toWei(params.amount);
          const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;

          // Get quote with slippage protection
          console.log('[SwapService] 🔍 Getting price quote...');
          const quote = await this.quoteService.getQuote({
            fromToken: WETH_ADDRESS,
            toToken: params.toToken,
            amountIn: BigInt(amountInWei),
            chainId: params.fromChainId,
            slippagePercent: MAX_SLIPPAGE_PERCENT,
          });

          console.log('[SwapService] 💰 Quote:', {
            expectedOutput: quote.amountOut.toString(),
            minimumOutput: quote.amountOutMinimum.toString(),
            priceImpact: `${quote.priceImpact.toFixed(2)}%`,
          });

          if (quote.priceImpact > 5.0) {
            console.warn(`[SwapService] ⚠️ High price impact: ${quote.priceImpact.toFixed(2)}%`);
          }

          const swapParams = {
            tokenIn: WETH_ADDRESS,
            tokenOut: params.toToken,
            fee: 3000,
            recipient: smartAccount.address,
            deadline: BigInt(deadline),
            amountIn: BigInt(amountInWei),
            amountOutMinimum: quote.amountOutMinimum,
            sqrtPriceLimitX96: BigInt(0),
          };

          const transaction = prepareContractCall({
            contract: swapRouterContract,
            method: 'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)',
            params: [swapParams],
            value: BigInt(amountInWei),
          });

          console.log('[SwapService] 📝 Executing swap transaction...');

          const result = await sendTransaction({
            transaction,
            account: smartAccount,
          });

          console.log('[SwapService] ✅ Swap executed successfully!');
          console.log('[SwapService] TX Hash:', result.transactionHash);

          // Audit log: Swap success
          await this.auditLogger.log({
            eventType: AuditEventType.SWAP_SUCCESS,
            userId: params.userId || params.smartAccountAddress,
            metadata: {
              txHash: result.transactionHash,
              smartAccountAddress: params.smartAccountAddress,
              fromToken: params.fromToken,
              toToken: params.toToken,
              amountIn: params.amount,
              amountOut: quote.amountOut.toString(),
              priceImpact: quote.priceImpact,
            },
          });

          return {
            txHash: result.transactionHash,
            amountIn: params.amount,
            amountOut: quote.amountOut.toString(),
          };

        } else {
          // ERC20 token swap
          console.log('[SwapService] 🪙 Swapping ERC20 token');

          const tokenContract = getContract({
            client,
            chain,
            address: params.fromToken,
          });

          const allowance = await getAllowance({
            contract: tokenContract,
            owner: smartAccount.address,
            spender: SWAP_ROUTER_ADDRESS,
          });

          const amountInWei = BigInt(toWei(params.amount));

          if (allowance < amountInWei) {
            console.log('[SwapService] 📝 Approving token spend...');

            const approveTransaction = approve({
              contract: tokenContract,
              spender: SWAP_ROUTER_ADDRESS,
              amountWei: amountInWei,
            });

            await sendTransaction({
              transaction: approveTransaction,
              account: smartAccount,
            });

            console.log('[SwapService] ✅ Token approved');
          }

          const swapRouterContract = getContract({
            client,
            chain,
            address: SWAP_ROUTER_ADDRESS,
          });

          const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;

          // Get quote with slippage protection
          console.log('[SwapService] 🔍 Getting price quote...');
          const quote = await this.quoteService.getQuote({
            fromToken: params.fromToken,
            toToken: params.toToken,
            amountIn: amountInWei,
            chainId: params.fromChainId,
            slippagePercent: MAX_SLIPPAGE_PERCENT,
          });

          console.log('[SwapService] 💰 Quote:', {
            expectedOutput: quote.amountOut.toString(),
            minimumOutput: quote.amountOutMinimum.toString(),
            priceImpact: `${quote.priceImpact.toFixed(2)}%`,
          });

          if (quote.priceImpact > 5.0) {
            console.warn(`[SwapService] ⚠️ High price impact: ${quote.priceImpact.toFixed(2)}%`);
          }

          const swapParams = {
            tokenIn: params.fromToken,
            tokenOut: params.toToken,
            fee: 3000,
            recipient: smartAccount.address,
            deadline: BigInt(deadline),
            amountIn: amountInWei,
            amountOutMinimum: quote.amountOutMinimum,
            sqrtPriceLimitX96: BigInt(0),
          };

          const transaction = prepareContractCall({
            contract: swapRouterContract,
            method: 'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) returns (uint256)',
            params: [swapParams],
          });

          console.log('[SwapService] 📝 Executing swap transaction...');

          const result = await sendTransaction({
            transaction,
            account: smartAccount,
          });

          console.log('[SwapService] ✅ Swap executed successfully!');
          console.log('[SwapService] TX Hash:', result.transactionHash);

          // Audit log: Swap success
          await this.auditLogger.log({
            eventType: AuditEventType.SWAP_SUCCESS,
            userId: params.userId || params.smartAccountAddress,
            metadata: {
              txHash: result.transactionHash,
              smartAccountAddress: params.smartAccountAddress,
              fromToken: params.fromToken,
              toToken: params.toToken,
              amountIn: params.amount,
              amountOut: quote.amountOut.toString(),
              priceImpact: quote.priceImpact,
            },
          });

          return {
            txHash: result.transactionHash,
            amountIn: params.amount,
            amountOut: quote.amountOut.toString(),
          };
        }
      } catch (error: any) {
        console.error('[SwapService] ❌ Swap failed:', error);

        // Audit log: Swap failure
        await this.auditLogger.log({
          eventType: AuditEventType.SWAP_FAILED,
          userId: params.userId || params.smartAccountAddress,
          metadata: {
            smartAccountAddress: params.smartAccountAddress,
            fromToken: params.fromToken,
            toToken: params.toToken,
            amount: params.amount,
            error: error.message,
          },
        });

        const wrappedError = new Error(`Swap execution failed: ${error.message}`);

        // Insufficient funds is a user-data problem, not a service failure.
        // Re-throw as a non-circuit-breaker error so it doesn't open the breaker
        // and block other strategies on the same chain.
        if (error.message?.includes('insufficient funds')) {
          (wrappedError as any).skipCircuitBreaker = true;
          throw wrappedError;
        }

        throw wrappedError;
      }
    });
  }
}
