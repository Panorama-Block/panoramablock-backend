/**
 * Express bootstrap for liquidity-service.
 *
 * Mounts /health, /, and /v1/capability/liquidity/* routes.
 * `buildLiquidityContainer` is the single place that touches concrete adapters.
 */

import cors from 'cors';
import express from 'express';

import { buildLiquidityRouter } from './infrastructure/http/routes/liquidity.routes';
import {
  buildLiquidityContainer,
  type LiquidityContainer,
} from './infrastructure/di/container';
import { ErrorHandler } from './infrastructure/http/middleware/errorHandler';

export interface CreateAppOptions {
  /** Inject a pre-built container — test convenience. Production builds the default. */
  liquidityContainer?: LiquidityContainer;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const liquidityContainer = options.liquidityContainer ?? buildLiquidityContainer();

  app.use(
    '/v1/capability/liquidity',
    buildLiquidityRouter({
      facade: liquidityContainer.facade,
      discoveryHandler: liquidityContainer.discoveryHandler,
    })
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      service: 'liquidity-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '0.1.0',
      providers: liquidityContainer.registry.size(),
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'PanoramaBlock Liquidity Service',
      description: 'Liquidity capability service (AMM LP). Aerodrome on Base, future Trader Joe on Avalanche.',
      version: '0.1.0',
      endpoints: {
        '/health': 'Service liveness',
        '/v1/capability/liquidity/_discovery': 'Provider availability snapshot',
        '/v1/capability/liquidity/pools': 'List pools on a chain',
        '/v1/capability/liquidity/position/:address/:poolId': 'User LP position in a pool',
        '/v1/capability/liquidity/apr/:poolId': 'Pool APR',
        '/v1/capability/liquidity/prepare-add': 'Transactions to add liquidity (POST)',
        '/v1/capability/liquidity/prepare-remove': 'Transactions to remove liquidity (POST)',
        '/v1/capability/liquidity/prepare-claim': 'Transactions to claim rewards (POST)',
      },
    });
  });

  app.use(ErrorHandler.handle);

  return app;
}
