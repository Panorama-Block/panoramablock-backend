import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { LidoRoutes } from './infrastructure/http/routes/lidoRoutes';
import { ErrorHandler } from './infrastructure/http/middleware/errorHandler';
import { DatabaseService } from './infrastructure/database/database.service';
import { EthereumConfig } from './infrastructure/config/ethereum';
import { ERROR_CODES, sendError } from './shared/errorCodes';
import { serializeByUser } from './middleware/serialize-by-user';

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const RL_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
  const RL_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  const rlBuckets = new Map<string, number[]>();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path || '';
    if (path === '/health' || path === '/' || req.method === 'OPTIONS') return next();

    const key =
      (req as any).user?.address?.toLowerCase() ||
      req.body?.userAddress?.toLowerCase() ||
      req.ip ||
      'unknown';

    const now = Date.now();
    const windowStart = now - RL_WINDOW_MS;
    const timestamps = (rlBuckets.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= RL_MAX) {
      sendError(
        res,
        429,
        ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded. Max ${RL_MAX} requests per ${RL_WINDOW_MS / 1000}s`,
      );
      return;
    }

    timestamps.push(now);
    rlBuckets.set(key, timestamps);

    if (rlBuckets.size > 10_000) {
      for (const [bucketKey, bucketTimestamps] of rlBuckets) {
        const fresh = bucketTimestamps.filter((t) => t > windowStart);
        if (fresh.length === 0) rlBuckets.delete(bucketKey);
        else rlBuckets.set(bucketKey, fresh);
      }
    }

    next();
  });

  app.use(serializeByUser);

  app.use('/api/lido', LidoRoutes);

  app.get('/health', async (_req, res) => {
    let dbOk = false;
    if (DatabaseService.isConfigured()) {
      try {
        dbOk = await DatabaseService.getInstance().checkConnection();
      } catch {
        dbOk = false;
      }
    }

    const ethConfig = EthereumConfig.getInstance();
    const cbState = ethConfig.circuitBreaker;
    const overallStatus = cbState.isOpen ? 'degraded' : 'healthy';

    res.status(200).json({
      status: overallStatus,
      service: 'lido-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      network: {
        name: 'Ethereum Mainnet',
        chainId: ethConfig.getChainId(),
      },
      circuitBreaker: {
        state: cbState.isOpen ? 'open' : 'closed',
      },
      database: {
        configured: DatabaseService.isConfigured(),
        connected: dbOk,
      },
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'PanoramaBlock Lido Service',
      description: 'Lido staking service with centralized authentication',
      version: '1.0.0',
      authentication: 'Uses centralized auth-service (same as liquid-swap-service)',
      authEndpoints: {
        login: 'POST http://auth-service:3001/auth/login',
        verify: 'POST http://auth-service:3001/auth/verify',
        validate: 'POST http://auth-service:3001/auth/validate',
      },
      endpoints: {
        '/health': 'Health check',
        '/api/lido/stake': 'Stake ETH (requires JWT)',
        '/api/lido/unstake': 'Unstake stETH (requires JWT)',
        '/api/lido/position/:userAddress': 'Get staking position (optional JWT)',
        '/api/lido/protocol/info': 'Get protocol info (public)',
        '/api/lido/history/:userAddress': 'Get staking history (optional JWT)',
        '/api/lido/withdrawals/:userAddress': 'Get withdrawal requests (optional JWT)',
        '/api/lido/withdrawals/claim': 'Claim finalized withdrawals (requires JWT)',
        '/api/lido/transaction/submit': 'Record tx hash for prepared tx (requires JWT)',
        '/api/lido/transaction/:txHash': 'Get transaction status (public)',
      },
    });
  });

  app.use(ErrorHandler.handle);

  return app;
}
