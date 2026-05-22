/**
 * Routes for `/v1/capability/staking/*`.
 *
 * Mounted in `app.ts` alongside the deprecated `/api/lido/*` routes (which keep working with a
 * `Deprecation: true` header for one release).
 *
 * Card #246 (SPRINT_HUGO.md).
 */

import { Router } from 'express';

import { AuthMiddleware } from '../middleware/auth';
import { ErrorHandler } from '../middleware/errorHandler';
import { StakingController } from '../controllers/StakingController';
import type { StakingCapabilityService } from '../../../application/services/staking.capability.service';
import type { DiscoveryHandler } from '@panorama/capability';

export interface StakingRoutesDeps {
  facade: StakingCapabilityService;
  discoveryHandler: DiscoveryHandler;
}

export function buildStakingRouter(deps: StakingRoutesDeps): Router {
  const router = Router();
  const ctrl = new StakingController({
    facade: deps.facade,
    discoveryHandler: deps.discoveryHandler,
  });

  // Public — used by FE / agents to know who's healthy.
  router.get(
    '/_discovery',
    ErrorHandler.asyncWrapper((req, res) => Promise.resolve(ctrl.discovery(req, res))),
  );

  // Public — APR + position can be read without auth (matches existing /api/lido/protocol/info policy).
  router.get(
    '/apr',
    ErrorHandler.asyncWrapper((req, res) => ctrl.getApr(req, res)),
  );
  router.get(
    '/position/:address',
    AuthMiddleware.optionalAuth,
    ErrorHandler.asyncWrapper((req, res) => ctrl.getPosition(req, res)),
  );

  // Auth-required: state-mutating prepare endpoints.
  router.post(
    '/prepare-stake',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireBodyUserAddress(),
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareStake(req, res)),
  );
  router.post(
    '/prepare-unstake',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireBodyUserAddress(),
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareUnstake(req, res)),
  );
  router.post(
    '/prepare-claim',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireBodyUserAddress(),
    ErrorHandler.asyncWrapper((req, res) => ctrl.prepareClaim(req, res)),
  );

  return router;
}
