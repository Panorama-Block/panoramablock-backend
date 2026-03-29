import { Router } from 'express';
import { DIContainer } from '../../di/container';

export function createPanoramaV1Routes(container: DIContainer): Router {
  const router = Router();
  const { panoramaV1Controller } = container;

  router.post('/wallets', (req, res, next) => panoramaV1Controller.createWallet(req, res, next));
  router.post('/wallets/create-export', (req, res, next) => panoramaV1Controller.createWalletExport(req, res, next));
  router.post('/wallets/link', (req, res, next) => panoramaV1Controller.linkWallet(req, res, next));
  router.get('/wallets/:id/context', (req, res, next) => panoramaV1Controller.getWalletContext(req, res, next));
  router.get('/wallets/:id/balances', (req, res, next) => panoramaV1Controller.getWalletBalances(req, res, next));
  router.post('/wallets/:id/sessions', (req, res, next) => panoramaV1Controller.registerWalletSession(req, res, next));
  router.post('/wallets/:id/ownership-challenge', (req, res, next) => panoramaV1Controller.prepareOwnershipChallenge(req, res, next));
  router.post('/wallets/:id/ownership-verify', (req, res, next) => panoramaV1Controller.verifyOwnership(req, res, next));
  router.get('/wallets/:id/ownership-status', (req, res, next) => panoramaV1Controller.getOwnershipStatus(req, res, next));
  router.post('/policies', (req, res, next) => panoramaV1Controller.createPolicy(req, res, next));
  router.post('/policies/:id/approve', (req, res, next) => panoramaV1Controller.approvePolicy(req, res, next));
  router.post('/policies/:id/revoke', (req, res, next) => panoramaV1Controller.revokePolicy(req, res, next));
  router.post('/swaps/prepare', (req, res, next) => panoramaV1Controller.prepareSwap(req, res, next));
  router.post('/swaps', (req, res, next) => panoramaV1Controller.createSwap(req, res, next));
  router.get('/swaps/:id', (req, res, next) => panoramaV1Controller.getSwap(req, res, next));
  router.post('/swaps/:id/submit', (req, res, next) => panoramaV1Controller.submitPreparedSwap(req, res, next));
  router.post('/swaps/:id/fail', (req, res, next) => panoramaV1Controller.failPreparedSwap(req, res, next));
  router.post('/staking/stake', (req, res, next) => panoramaV1Controller.createStake(req, res, next));
  router.get('/staking/liquid/position/:address', (req, res, next) => panoramaV1Controller.getLiquidStakePosition(req, res, next));
  router.post('/staking/liquid/prepare-stake', (req, res, next) => panoramaV1Controller.prepareLiquidStake(req, res, next));
  router.post('/staking/liquid/prepare-request-unlock', (req, res, next) => panoramaV1Controller.prepareLiquidUnlock(req, res, next));
  router.post('/staking/liquid/prepare-redeem', (req, res, next) => panoramaV1Controller.prepareLiquidRedeem(req, res, next));
  router.post('/staking/liquid/:id/submit', (req, res, next) => panoramaV1Controller.submitPreparedLiquidOperation(req, res, next));
  router.post('/staking/liquid/:id/fail', (req, res, next) => panoramaV1Controller.failPreparedLiquidOperation(req, res, next));
  router.get('/staking/:id', (req, res, next) => panoramaV1Controller.getStake(req, res, next));
  router.get('/lending/markets', (req, res, next) => panoramaV1Controller.getLendingMarkets(req, res, next));
  router.post('/lending/act', (req, res, next) => panoramaV1Controller.createLendingAction(req, res, next));
  router.get('/lending/:id', (req, res, next) => panoramaV1Controller.getLendingOperation(req, res, next));
  router.post('/events/webhooks', (req, res, next) => panoramaV1Controller.registerWebhook(req, res, next));

  return router;
}
