import { Router, Request, Response } from 'express';
import { readLimiter, generalLimiter } from '../middleware/rateLimit.middleware';

const EXECUTION_LAYER_URL = process.env.EXECUTION_LAYER_URL || 'http://localhost:3010';

async function proxyToExecutionLayer(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${EXECUTION_LAYER_URL}/dca${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (method === 'POST' && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({ error: 'Invalid response from execution layer' }));
  return { status: res.status, data };
}

export function vaultDcaRoutes(): Router {
  const router = Router();

  /**
   * POST /dca/vault/prepare-create
   * Prepare unsigned transactions to create a DCAVault order.
   * Body: { userAddress, tokenIn, tokenOut, amountPerSwap, intervalSeconds, remainingSwaps?, stable?, depositAmount }
   */
  router.post('/prepare-create', generalLimiter, async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxyToExecutionLayer('/prepare-create', 'POST', req.body);
      return res.status(status).json(data);
    } catch (err: any) {
      console.error('[vault-dca] prepare-create error:', err.message);
      return res.status(502).json({ error: 'Execution layer unavailable', detail: err.message });
    }
  });

  /**
   * POST /dca/vault/prepare-cancel
   * Prepare unsigned transaction to cancel + optionally withdraw from a DCAVault order.
   * Body: { userAddress, orderId, withdrawAfter? }
   */
  router.post('/prepare-cancel', generalLimiter, async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxyToExecutionLayer('/prepare-cancel', 'POST', req.body);
      return res.status(status).json(data);
    } catch (err: any) {
      console.error('[vault-dca] prepare-cancel error:', err.message);
      return res.status(502).json({ error: 'Execution layer unavailable', detail: err.message });
    }
  });

  /**
   * GET /dca/vault/orders/:userAddress
   * Get all DCAVault orders for a wallet address.
   */
  router.get('/orders/:userAddress', readLimiter, async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxyToExecutionLayer(
        `/orders/${req.params.userAddress}`,
        'GET',
      );
      return res.status(status).json(data);
    } catch (err: any) {
      console.error('[vault-dca] orders error:', err.message);
      return res.status(502).json({ error: 'Execution layer unavailable', detail: err.message });
    }
  });

  /**
   * GET /dca/vault/order/:orderId
   * Get a single DCAVault order by ID.
   */
  router.get('/order/:orderId', readLimiter, async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxyToExecutionLayer(
        `/order/${req.params.orderId}`,
        'GET',
      );
      return res.status(status).json(data);
    } catch (err: any) {
      console.error('[vault-dca] order error:', err.message);
      return res.status(502).json({ error: 'Execution layer unavailable', detail: err.message });
    }
  });

  /**
   * GET /dca/vault/history/:userAddress
   * Get execution history for a user's DCAVault orders.
   */
  router.get('/history/:userAddress', readLimiter, async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxyToExecutionLayer(
        `/history/${req.params.userAddress}`,
        'GET',
      );
      return res.status(status).json(data);
    } catch (err: any) {
      console.error('[vault-dca] history error:', err.message);
      return res.status(502).json({ error: 'Execution layer unavailable', detail: err.message });
    }
  });

  return router;
}
