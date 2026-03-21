import { PrismaClient } from '@prisma/client';
import { validateEnvironment, EnvironmentConfig } from '../../config/environment';

// Domain Ports
import { BridgeProviderPort } from '../../domain/ports/BridgeProviderPort';

// Infrastructure implementations
import { LayerswapAdapter } from '../adapters/LayerswapAdapter';
import { ThirdwebWalletAdapter } from '../adapters/ThirdwebWalletAdapter';
import { WdkWalletAdapter } from '../adapters/WdkWalletAdapter';
import { DatabaseGatewayClient } from '../clients/DatabaseGatewayClient';
import { LiquidSwapClient } from '../clients/LiquidSwapClient';
import { LidoClient } from '../clients/LidoClient';
import { LendingClient } from '../clients/LendingClient';

// Application Use Cases
import { CreateBridgeTransactionUseCase } from '../../application/use-cases/CreateBridgeTransactionUseCase';
import { GetBridgeQuoteUseCase } from '../../application/use-cases/GetBridgeQuoteUseCase';
import { GetBridgeStatusUseCase } from '../../application/use-cases/GetBridgeStatusUseCase';
import { PanoramaV1Service } from '../../application/services/PanoramaV1Service';
import { WalletBalanceReader } from '../../application/services/WalletBalanceReader';

// Controllers
import { BridgeController } from '../../interfaces/http/controllers/BridgeController';
import { PanoramaV1Controller } from '../../interfaces/http/controllers/PanoramaV1Controller';
import { WalletProviderAdapterPort } from '../../domain/ports/WalletProviderAdapterPort';

export interface DIContainer {
  config: EnvironmentConfig;
  database: PrismaClient;
  layerswapAdapter: BridgeProviderPort;
  createBridgeTransaction: CreateBridgeTransactionUseCase;
  getBridgeQuote: GetBridgeQuoteUseCase;
  getBridgeStatus: GetBridgeStatusUseCase;
  bridgeController: BridgeController;
  databaseGatewayClient: DatabaseGatewayClient;
  liquidSwapClient: LiquidSwapClient;
  lidoClient: LidoClient;
  lendingClient: LendingClient;
  panoramaV1Service: PanoramaV1Service;
  panoramaV1Controller: PanoramaV1Controller;
}

export async function createDIContainer(): Promise<DIContainer> {
  const config = validateEnvironment();

  const prismaLogLevels: ('query' | 'info' | 'warn' | 'error')[] = ['warn', 'error'];
  if (config.DEBUG) prismaLogLevels.push('info');
  if (process.env.PRISMA_LOG_QUERIES === 'true') prismaLogLevels.unshift('query');

  const database = new PrismaClient({
    log: prismaLogLevels,
    datasources: {
      db: {
        url: config.DATABASE_URL
      }
    }
  });

  await database.$connect();

  const layerswapAdapter = new LayerswapAdapter();
  const databaseGatewayClient = new DatabaseGatewayClient();
  const liquidSwapClient = new LiquidSwapClient(
    config.LIQUID_SWAP_SERVICE_URL || 'http://localhost:3002',
    process.env.LIQUID_SWAP_SERVICE_TOKEN
  );
  const lidoClient = new LidoClient(config.LIDO_SERVICE_URL || 'http://localhost:3004');
  const lendingClient = new LendingClient(config.LENDING_SERVICE_URL || 'http://localhost:3006');
  const thirdwebAdapter = new ThirdwebWalletAdapter(process.env.THIRDWEB_ENGINE_URL, process.env.ENGINE_ACCESS_TOKEN);
  let wdkAdapter: WalletProviderAdapterPort;
  try {
    wdkAdapter = new WdkWalletAdapter({
      supportedChains: config.WDK_SUPPORTED_CHAINS
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is 'evm' | 'ton' => value === 'evm' || value === 'ton'),
      evmRpcUrl: config.WDK_EVM_RPC_URL,
      tonRpcUrl: config.WDK_TON_RPC_URL,
      seed: config.WDK_SEED,
      requireSession: config.WDK_REQUIRE_SESSION,
      simulateExecution: config.WDK_SIMULATE_EXECUTION,
    });
  } catch (error) {
    wdkAdapter = {
      provider: 'wdk',
      async createWallet() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async linkWallet() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async registerSession() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async prepareSignature() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async signIntent() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async assertExecutionAllowed() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async executePlan() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      async getExecutionContext() {
        throw new Error(`WDK adapter unavailable: ${(error as Error).message}`);
      },
      getExecutionStrategy() {
        return 'client';
      },
    };
  }

  const createBridgeTransaction = new CreateBridgeTransactionUseCase(layerswapAdapter);
  const getBridgeQuote = new GetBridgeQuoteUseCase(layerswapAdapter);
  const getBridgeStatus = new GetBridgeStatusUseCase(layerswapAdapter);
  const bridgeController = new BridgeController(createBridgeTransaction, getBridgeQuote, getBridgeStatus);
  const panoramaV1Service = new PanoramaV1Service(databaseGatewayClient, liquidSwapClient, lidoClient, lendingClient, {
    thirdweb: thirdwebAdapter,
    wdk: wdkAdapter,
  }, config.WALLET_PROVIDER_DEFAULT, new WalletBalanceReader());
  const panoramaV1Controller = new PanoramaV1Controller(panoramaV1Service, config.WALLET_PROVIDER_DEFAULT);

  return {
    config,
    database,
    layerswapAdapter,
    createBridgeTransaction,
    getBridgeQuote,
    getBridgeStatus,
    bridgeController,
    databaseGatewayClient,
    liquidSwapClient,
    lidoClient,
    lendingClient,
    panoramaV1Service,
    panoramaV1Controller,
  };
}

export async function closeDIContainer(container: DIContainer): Promise<void> {
  try {
    await container.database.$disconnect();
    console.log('✅ DI Container gracefully shutdown');
  } catch (error) {
    console.error('❌ Error during container shutdown:', error);
    throw error;
  }
}
