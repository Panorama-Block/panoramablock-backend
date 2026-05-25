/**
 * Capability Router — /v1/capability/dca/* endpoints.
 *
 * Mounts:
 *   POST   /v1/capability/dca/account               createAccount
 *   GET    /v1/capability/dca/account/:address       getAccount
 *   GET    /v1/capability/dca/accounts/:userId       getUserAccounts
 *   POST   /v1/capability/dca/strategy               createStrategy
 *   GET    /v1/capability/dca/strategies/:accountId  getStrategies
 *   PATCH  /v1/capability/dca/strategy/:id/toggle    toggleStrategy
 *   DELETE /v1/capability/dca/strategy/:id           deleteStrategy
 *   GET    /v1/capability/dca/history/:accountId     getHistory
 *   POST   /v1/capability/dca/execute                signAndExecute
 *   POST   /v1/capability/dca/validate               validatePermissions
 *   POST   /v1/capability/dca/withdraw               withdraw
 *   GET    /v1/capability/_discovery                 discovery
 *
 * Also re-mounts legacy /dca/* and /transaction/* routes with Deprecation + Sunset headers.
 *
 * CapabilityRequest.userAddress is always sourced from req.user.id (Telegram auth).
 * Callers must pass x-trace-id; x-tenant-id defaults to "panorama".
 * x-idempotency-key is optional for read endpoints, recommended for mutating ones.
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createDiscoveryHandler,
  ProviderRegistry,
  ChainAssetPriorityPolicy,
  CapabilityError,
  categoryToHttpStatus,
} from '@panorama/capability';
import type { CapabilityRequest } from '@panorama/capability';

import { ERC4337DCAAdapter } from '../../adapters/erc4337.dca.adapter';
import { DCACapabilityService } from '../../../application/services/dca.capability.service';
import type { IDCAProvider } from '../../../domain/ports/dca.provider.port';
import {
  verifyTelegramAuth,
  devBypassAuth,
  type AuthenticatedRequest,
} from '../../../middleware/auth.middleware';
import {
  createAccountLimiter,
  createStrategyLimiter,
  readLimiter,
  transactionLimiter,
  generalLimiter,
} from '../../../middleware/rateLimit.middleware';

// ─── Bootstrap: registry + policy + service ──────────────────────────────────

const provider = new ERC4337DCAAdapter();
const registry = new ProviderRegistry<IDCAProvider>();
registry.register(provider);

const policy = new ChainAssetPriorityPolicy({
  // ERC-4337 adapter is the only automation provider — priority on all supported chains.
  '1':     ['erc4337-dca'],
  '137':   ['erc4337-dca'],
  '42161': ['erc4337-dca'],
  '10':    ['erc4337-dca'],
  '8453':  ['erc4337-dca'],
});

const svc = new DCACapabilityService({ registry, policy });

const discoveryHandler = createDiscoveryHandler({
  listProviders: () => registry.listAll(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createCapabilityRouter(): Router {
  const router = Router();

  const auth = [devBypassAuth, verifyTelegramAuth];

  // ── Account endpoints ──────────────────────────────────────────────────────

  router.post('/dca/account', createAccountLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, req.body);
    const result = await svc.createAccount(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.get('/dca/account/:address', readLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, { address: req.params.address });
    const result = await svc.getAccount(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.get('/dca/accounts/:userId', readLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, { userId: req.params.userId });
    const result = await svc.getUserAccounts(capReq);
    return sendCapabilityResponse(res, result);
  });

  // ── Strategy endpoints ─────────────────────────────────────────────────────

  router.post('/dca/strategy', createStrategyLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, req.body);
    const result = await svc.createStrategy(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.get('/dca/strategies/:accountId', readLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, { smartAccountId: req.params.accountId });
    const result = await svc.getStrategies(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.patch('/dca/strategy/:id/toggle', generalLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    if (typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }
    const capReq = buildReq(req, { strategyId: req.params.id, isActive: req.body.isActive });
    const result = await svc.toggleStrategy(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.delete('/dca/strategy/:id', generalLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, { strategyId: req.params.id });
    const result = await svc.deleteStrategy(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.get('/dca/history/:accountId', readLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const capReq = buildReq(req, { smartAccountId: req.params.accountId, limit });
    const result = await svc.getHistory(capReq);
    return sendCapabilityResponse(res, result);
  });

  // ── Transaction endpoints ──────────────────────────────────────────────────

  router.post('/dca/execute', transactionLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, req.body);
    const result = await svc.signAndExecute(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.post('/dca/validate', generalLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, req.body);
    const result = await svc.validatePermissions(capReq);
    return sendCapabilityResponse(res, result);
  });

  router.post('/dca/withdraw', transactionLimiter, ...auth, async (req: AuthenticatedRequest, res: Response) => {
    const capReq = buildReq(req, req.body);
    const result = await svc.withdraw(capReq);
    return sendCapabilityResponse(res, result);
  });

  // ── Discovery ──────────────────────────────────────────────────────────────

  router.get('/_discovery', readLimiter, (req: Request, res: Response) => {
    const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
    const result = discoveryHandler({ traceId, force: req.query.force === 'true' });
    res.setHeader('Cache-Control', `public, max-age=${result.data.cacheTtlSeconds}`);
    return res.status(200).json(result);
  });

  return router;
}

// ─── Legacy router (Deprecation + Sunset headers) ────────────────────────────

const DEPRECATION_DATE = 'Sat, 01 Nov 2025 00:00:00 GMT';
const SUNSET_DATE = 'Mon, 01 Dec 2025 00:00:00 GMT';
const DEPRECATION_LINK = 'https://docs.panoramablock.com/api/deprecation#dca-v0';

function deprecationHeaders(res: Response): void {
  res.setHeader('Deprecation', DEPRECATION_DATE);
  res.setHeader('Sunset', SUNSET_DATE);
  res.setHeader('Link', `<${DEPRECATION_LINK}>; rel="deprecation"`);
}

/**
 * Legacy route shim — proxies old paths to the new capability service and adds
 * Deprecation + Sunset headers so clients know to migrate.
 */
export function createLegacyCapabilityShim(): Router {
  const router = Router();
  const auth = [devBypassAuth, verifyTelegramAuth];

  const wrap =
    (handler: (req: AuthenticatedRequest, res: Response) => Promise<Response | void>) =>
    async (req: AuthenticatedRequest, res: Response) => {
      deprecationHeaders(res);
      return handler(req, res);
    };

  // /dca/create-account → POST /v1/capability/dca/account
  router.post('/create-account', createAccountLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, req.body);
      return sendCapabilityResponse(res, await svc.createAccount(capReq));
    }),
  );

  // /dca/accounts/:userId
  router.get('/accounts/:userId', readLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, { userId: req.params.userId });
      return sendCapabilityResponse(res, await svc.getUserAccounts(capReq));
    }),
  );

  // /dca/account/:address
  router.get('/account/:address', readLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, { address: req.params.address });
      return sendCapabilityResponse(res, await svc.getAccount(capReq));
    }),
  );

  // /dca/create-strategy
  router.post('/create-strategy', createStrategyLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, req.body);
      return sendCapabilityResponse(res, await svc.createStrategy(capReq));
    }),
  );

  // /dca/strategies/:smartAccountId
  router.get('/strategies/:smartAccountId', readLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, { smartAccountId: req.params.smartAccountId });
      return sendCapabilityResponse(res, await svc.getStrategies(capReq));
    }),
  );

  // /dca/strategy/:strategyId/toggle
  router.patch('/strategy/:strategyId/toggle', generalLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, { strategyId: req.params.strategyId, isActive: req.body.isActive });
      return sendCapabilityResponse(res, await svc.toggleStrategy(capReq));
    }),
  );

  // /dca/strategy/:strategyId (DELETE)
  router.delete('/strategy/:strategyId', generalLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, { strategyId: req.params.strategyId });
      return sendCapabilityResponse(res, await svc.deleteStrategy(capReq));
    }),
  );

  // /dca/history/:smartAccountId
  router.get('/history/:smartAccountId', readLimiter, ...auth,
    wrap(async (req, res) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const capReq = buildReq(req, { smartAccountId: req.params.smartAccountId, limit });
      return sendCapabilityResponse(res, await svc.getHistory(capReq));
    }),
  );

  return router;
}

/**
 * Legacy transaction route shim (/transaction/*).
 */
export function createLegacyTransactionShim(): Router {
  const router = Router();
  const auth = [devBypassAuth, verifyTelegramAuth];

  const wrap =
    (handler: (req: AuthenticatedRequest, res: Response) => Promise<Response | void>) =>
    async (req: AuthenticatedRequest, res: Response) => {
      deprecationHeaders(res);
      return handler(req, res);
    };

  // /transaction/sign-and-execute → POST /v1/capability/dca/execute
  router.post('/sign-and-execute', transactionLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, req.body);
      return sendCapabilityResponse(res, await svc.signAndExecute(capReq));
    }),
  );

  // /transaction/validate → POST /v1/capability/dca/validate
  router.post('/validate', generalLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, req.body);
      return sendCapabilityResponse(res, await svc.validatePermissions(capReq));
    }),
  );

  // /transaction/withdraw-token → POST /v1/capability/dca/withdraw
  router.post('/withdraw-token', transactionLimiter, ...auth,
    wrap(async (req, res) => {
      const capReq = buildReq(req, req.body);
      return sendCapabilityResponse(res, await svc.withdraw(capReq));
    }),
  );

  return router;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReq<T>(req: AuthenticatedRequest, payload: T): CapabilityRequest<T> {
  return {
    tenantId: (req.headers['x-tenant-id'] as string) || 'panorama',
    traceId: (req.headers['x-trace-id'] as string) || randomUUID(),
    idempotencyKey: req.headers['x-idempotency-key'] as string | undefined,
    // chainId from body, query, or default to Base (8453)
    chainId: parseInt((req.body?.chainId ?? req.body?.fromChainId ?? req.query.chainId ?? '8453') as string),
    userAddress: req.user?.id ?? '',
    payload,
    receivedAt: new Date().toISOString(),
  };
}

function sendCapabilityResponse(res: Response, result: { status: string; error?: any }): Response {
  if (result.status === 'error') {
    const httpStatus = (result.error as any)?.httpStatus ?? 500;
    return res.status(httpStatus).json(result);
  }
  return res.status(200).json(result);
}
