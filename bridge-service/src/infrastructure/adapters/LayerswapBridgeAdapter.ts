import axios, { AxiosInstance } from 'axios';
import { CapabilityError, ErrorCategory } from '../../../../shared/capability/errors';
import type { ProviderMetadata, ProviderHealth } from '../../../../shared/capability/provider.types';
import type {
  IBridgeProvider,
  BridgeRouteRequest,
  BridgeLimits,
  BridgeQuoteRequest,
  BridgeQuoteResult,
  BridgeTransactionRequest,
  BridgeTransactionResult,
  BridgeSwapStatus,
} from '../../domain/ports/bridge.provider.port';

// Layerswap network slugs → EVM chain IDs (for metadata.supportedChains)
const LAYERSWAP_EVM_CHAIN_IDS = [
  1,      // Ethereum
  8453,   // Base
  42161,  // Arbitrum
  43114,  // Avalanche
  607,    // TON (pseudo chain-id used in our manifests)
];

// Networks that Layerswap considers valid sources or destinations
const SUPPORTED_NETWORKS = new Set([
  'TON_MAINNET',
  'ETHEREUM_MAINNET',
  'BASE_MAINNET',
  'ARBITRUM_MAINNET',
  'AVALANCHE_MAINNET',
]);

export class LayerswapBridgeAdapter implements IBridgeProvider {
  readonly name = 'layerswap';

  readonly metadata: ProviderMetadata = {
    name: 'layerswap',
    capability: 'bridge',
    supportedChains: LAYERSWAP_EVM_CHAIN_IDS,
    features: ['cross-chain', 'ton-to-evm', 'evm-to-evm'],
    version: '1.0.0',
    enabled: true,
  };

  private readonly client: AxiosInstance;
  private readonly tonVaultAddress: string;

  constructor() {
    const apiKey = process.env.LAYERSWAP_API_KEY || '';
    if (!apiKey) {
      console.warn('[LayerswapBridgeAdapter] LAYERSWAP_API_KEY is not set');
    }

    this.client = axios.create({
      baseURL: 'https://api.layerswap.io/api/v2',
      headers: {
        'X-LS-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
    });

    this.tonVaultAddress = process.env.LAYERSWAP_TON_VAULT || '';
    if (!this.tonVaultAddress) {
      console.warn('[LayerswapBridgeAdapter] LAYERSWAP_TON_VAULT is not set');
      throw new Error('LAYERSWAP_TON_VAULT is not set');
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.get('/limits', {
        params: {
          source_network: 'TON_MAINNET',
          source_token: 'USDT',
          destination_network: 'BASE_MAINNET',
          destination_token: 'USDT',
        },
        timeout: 5000,
      });
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: e instanceof Error ? e.message : 'unknown',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async supportsRoute(sourceNetwork: string, destinationNetwork: string): Promise<boolean> {
    return SUPPORTED_NETWORKS.has(sourceNetwork) && SUPPORTED_NETWORKS.has(destinationNetwork);
  }

  async getLimits(req: BridgeRouteRequest): Promise<BridgeLimits> {
    const sourceToken = req.sourceToken ?? 'USDT';
    const destinationToken = req.destinationToken ?? 'USDT';

    try {
      const response = await this.client.get('/limits', {
        params: {
          source_network: req.sourceNetwork,
          source_token: sourceToken,
          destination_network: req.destinationNetwork,
          destination_token: destinationToken,
        },
      });

      const data = response.data?.data ?? response.data;
      return {
        minAmount: data?.min_amount ?? 0,
        maxAmount: data?.max_amount ?? 0,
        sourceNetwork: req.sourceNetwork,
        destinationNetwork: req.destinationNetwork,
        sourceToken,
        destinationToken,
      };
    } catch (error) {
      throw CapabilityError.providerFailure({
        capability: 'bridge',
        provider: this.name,
        message: 'Failed to fetch limits from Layerswap',
        cause: error,
      });
    }
  }

  async getQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult> {
    const sourceToken = req.sourceToken ?? 'USDT';
    const destinationToken = req.destinationToken ?? 'USDT';

    try {
      const response = await this.client.get('/quote', {
        params: {
          source_network: req.sourceNetwork,
          source_token: sourceToken,
          destination_network: req.destinationNetwork,
          destination_token: destinationToken,
          amount: req.amount,
          refuel: req.refuel,
        },
      });

      const data = response.data?.data ?? response.data;
      const quoteData = data?.quote ?? data;

      return {
        receiveAmount: quoteData?.receive_amount ?? 0,
        fee: quoteData?.fee ?? 0,
        sourceNetwork: req.sourceNetwork,
        destinationNetwork: req.destinationNetwork,
        sourceToken,
        destinationToken,
        refuelAmount: data?.refuel?.amount,
        refuelAmountUsd: data?.refuel?.amount_in_usd,
      };
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 422) {
        throw new CapabilityError({
          code: 'CAPABILITY_BRIDGE_INSUFFICIENT_LIQUIDITY',
          category: ErrorCategory.INSUFFICIENT_LIQUIDITY,
          message: error?.response?.data?.error?.message ?? 'Insufficient liquidity for this bridge route',
          provider: this.name,
          cause: error,
        });
      }
      throw CapabilityError.providerFailure({
        capability: 'bridge',
        provider: this.name,
        message: error?.response?.data?.error?.message ?? 'Failed to get quote from Layerswap',
        cause: error,
      });
    }
  }

  async createTransaction(req: BridgeTransactionRequest): Promise<BridgeTransactionResult> {
    const sourceToken = req.sourceToken ?? 'USDT';
    const destinationToken = req.destinationToken ?? 'USDT';

    try {
      const payload = {
        source_network: req.sourceNetwork,
        source_token: sourceToken,
        destination_network: req.destinationNetwork,
        destination_token: destinationToken,
        amount: req.amount,
        destination_address: req.destinationAddress,
        source_address: req.sourceAddress,
        refuel: req.refuel,
        use_deposit_address: req.destinationNetwork === 'TON_MAINNET',
      };

      const response = await this.client.post('/swaps', payload);
      const data = response.data?.data ?? response.data;
      const swapData = data?.swap ?? data;
      const depositActions = data?.deposit_actions;

      let depositAddress = req.sourceNetwork === 'TON_MAINNET' ? this.tonVaultAddress : '';
      let comment: string | undefined;

      if (Array.isArray(depositActions)) {
        const transferAction = depositActions.find(
          (a: any) => a.type === 'transfer' || a.type === 'manual_transfer',
        );
        if (transferAction) {
          if (transferAction.to_address) depositAddress = transferAction.to_address;
          if (transferAction.call_data) {
            try {
              const callData =
                typeof transferAction.call_data === 'string'
                  ? JSON.parse(transferAction.call_data)
                  : transferAction.call_data;
              if (callData.comment) comment = callData.comment;
            } catch {
              console.warn('[LayerswapBridgeAdapter] Failed to parse call_data');
            }
          }
        }
      }

      if (!depositAddress) {
        throw CapabilityError.providerFailure({
          capability: 'bridge',
          provider: this.name,
          message: 'Failed to determine deposit address from Layerswap response',
        });
      }

      return {
        swapId: swapData.id,
        depositAddress,
        amount: String(swapData.requested_amount ?? req.amount),
        status: 'PENDING',
        comment,
        depositActions,
      };
    } catch (error: any) {
      if (CapabilityError.is(error)) throw error;
      const msg =
        error?.response?.data?.error?.message ??
        error?.response?.data?.message ??
        'Failed to create swap on Layerswap';
      throw CapabilityError.providerFailure({
        capability: 'bridge',
        provider: this.name,
        message: msg,
        cause: error,
      });
    }
  }

  async getStatus(swapId: string): Promise<BridgeSwapStatus> {
    try {
      const response = await this.client.get(`/swaps/${encodeURIComponent(swapId)}`);
      const data = response.data?.data ?? response.data;
      const swapData = data?.swap ?? data;
      return swapData as BridgeSwapStatus;
    } catch (error) {
      throw CapabilityError.providerFailure({
        capability: 'bridge',
        provider: this.name,
        message: 'Failed to get swap status from Layerswap',
        cause: error,
      });
    }
  }
}
