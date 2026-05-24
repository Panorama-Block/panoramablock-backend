/**
 * Routes for `/v1/capability/liquidity/*`. Mounted in `app.ts`.
 */

import { Router } from 'express';

import type { DiscoveryHandler } from '@panorama/capability';

import type { LiquidityCapabilityService } from '../../../application/services/liquidity.capability.service';
import { LiquidityController } from '../controllers/liquidity.controller';
import { ErrorHandler } from '../middleware/errorHandler';

export interface LiquidityRoutesDeps {
  facade: LiquidityCapabilityService;
  discoveryHandler: DiscoveryHandler;
}

export function buildLiquidityRouter(deps: LiquidityRoutesDeps): Router {
  const router = Router();
  const ctrl = new LiquidityController({
    facade: deps.facade,
    discoveryHandler: deps.discoveryHandler,
  });

  // Public introspection.
  router.get(
    '/_discovery',
    ErrorHandler.asyncWrapper((req, res) => Promise.resolve(ctrl.discovery(req, res)))
  );

  // Reads — public for now. Auth wraps to be added when the central auth middleware lands here.
  router.get('/pools', ErrorHandler.asyncWrapper((req, res) => ctrl.getPools(req, res)));
  router.get(
    '/position/:address/:poolId',
    ErrorHandler.asyncWrapper((req, res) => ctrl.getPosition(req, res))
  );
  router.get('/apr/:poolId', ErrorHandler.asyncWrapper((req, res) => ctrl.getApr(req, res)));

  // State-mutating prepare endpoints — return Transaction[] for client-side signature.
  // No on-chain mutation happens here; the bundle is signed by the user's wallet.
  router.post(
    '/prepare-add',
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareAdd(req, res))
  );
  router.post(
    '/prepare-remove',
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareRemove(req, res))
  );
  router.post(
    '/prepare-claim',
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareClaim(req, res))
  );

  return router;
}
