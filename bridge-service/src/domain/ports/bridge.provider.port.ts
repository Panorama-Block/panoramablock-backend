import type { ICapabilityProvider } from '../../../../shared/capability/provider.types';

// ---------------------------------------------------------------------------
// Route / token pair
// ---------------------------------------------------------------------------

export interface BridgeRouteRequest {
  sourceNetwork: string;
  destinationNetwork: string;
  sourceToken?: string;
  destinationToken?: string;
}

// ---------------------------------------------------------------------------
// getLimits
// ---------------------------------------------------------------------------

export interface BridgeLimits {
  minAmount: number;
  maxAmount: number;
  sourceNetwork: string;
  destinationNetwork: string;
  sourceToken: string;
  destinationToken: string;
}

// ---------------------------------------------------------------------------
// getQuote
// ---------------------------------------------------------------------------

export interface BridgeQuoteRequest extends BridgeRouteRequest {
  amount: number;
  refuel?: boolean;
}

export interface BridgeQuoteResult {
  receiveAmount: number;
  fee: number;
  sourceNetwork: string;
  destinationNetwork: string;
  sourceToken: string;
  destinationToken: string;
  refuelAmount?: number;
  refuelAmountUsd?: number;
}

// ---------------------------------------------------------------------------
// createTransaction
// ---------------------------------------------------------------------------

export interface BridgeTransactionRequest extends BridgeRouteRequest {
  amount: number;
  destinationAddress: string;
  sourceAddress?: string;
  refuel?: boolean;
}

export interface BridgeTransactionResult {
  swapId: string;
  depositAddress: string;
  amount: string;
  status: string;
  comment?: string;
  depositActions?: unknown;
}

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

export interface BridgeSwapStatus {
  id: string;
  status: string;
  sourceNetwork: string;
  destinationNetwork: string;
  sourceToken: string;
  destinationToken: string;
  requestedAmount: number;
  receivedAmount?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// IBridgeProvider — extends the shared capability base
// ---------------------------------------------------------------------------

export interface IBridgeProvider extends ICapabilityProvider {
  /**
   * Whether this provider can handle the given source→destination route.
   * Called by fallbackInvoke before attempting any action.
   */
  supportsRoute(sourceNetwork: string, destinationNetwork: string): Promise<boolean>;

  /**
   * GET /api/v2/limits — min/max amounts for a route.
   */
  getLimits(req: BridgeRouteRequest): Promise<BridgeLimits>;

  /**
   * GET /api/v2/quote (or POST) — estimated receive amount + fees.
   */
  getQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult>;

  /**
   * POST /api/v2/swaps — create the swap and return deposit instructions.
   */
  createTransaction(req: BridgeTransactionRequest): Promise<BridgeTransactionResult>;

  /**
   * GET /api/v2/swaps/:swapId — poll swap status.
   */
  getStatus(swapId: string): Promise<BridgeSwapStatus>;
}
