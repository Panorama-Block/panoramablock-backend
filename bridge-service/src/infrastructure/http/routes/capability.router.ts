import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { buildSuccess, buildError } from '../../../../../shared/capability/envelope.types';
import { CapabilityError } from '../../../../../shared/capability/errors';
import { createDiscoveryHandler } from '../../../../../shared/capability/http/discovery.handler';
import type { BridgeCapabilityService } from '../../../application/bridge.capability.service';
import type { IBridgeProvider } from '../../../domain/ports/bridge.provider.port';

const RouteQuerySchema = z.object({
  sourceNetwork: z.string().min(1),
  destinationNetwork: z.string().min(1),
  sourceToken: z.string().optional(),
  destinationToken: z.string().optional(),
});

const QuoteBodySchema = z.object({
  sourceNetwork: z.string().min(1),
  destinationNetwork: z.string().min(1),
  amount: z.number().positive(),
  sourceToken: z.string().optional(),
  destinationToken: z.string().optional(),
  refuel: z.boolean().optional(),
});

const TransactionBodySchema = z.object({
  sourceNetwork: z.string().min(1),
  destinationNetwork: z.string().min(1),
  amount: z.number().positive(),
  destinationAddress: z.string().min(1),
  sourceAddress: z.string().optional(),
  sourceToken: z.string().optional(),
  destinationToken: z.string().optional(),
  refuel: z.boolean().optional(),
});

function traceId(req: Request): string {
  return (req as any).traceId ?? uuidv4();
}

function wrapError(error: unknown, tid: string, res: Response): void {
  const err = CapabilityError.is(error)
    ? (error as CapabilityError)
    : CapabilityError.internal('Unexpected error', error);

  const response = buildError({ error: err, traceId: tid, latencyMs: 0 });
  res.status(err.httpStatus).json(response);
}

export function createCapabilityRouter(
  bridgeService: BridgeCapabilityService,
  providers: IBridgeProvider[],
): Router {
  const router = Router();

  // Discovery handler — built once, caches 30s
  const discoveryHandler = createDiscoveryHandler({
    listProviders: () => providers,
    cacheTtlSeconds: 30,
  });

  // GET /v1/capability/_discovery
  router.get('/_discovery', (req: Request, res: Response) => {
    const result = discoveryHandler({ traceId: traceId(req), force: req.query.force === 'true' });
    res.status(200).json(result);
  });

  // GET /v1/capability/bridge/limits?sourceNetwork=&destinationNetwork=&sourceToken=&destinationToken=
  router.get('/bridge/limits', async (req: Request, res: Response, next: NextFunction) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const parsed = RouteQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw CapabilityError.validation({ capability: 'bridge', message: 'Invalid query parameters', errors: parsed.error.flatten() });
      }
      const data = await bridgeService.getLimits(parsed.data);
      res.status(200).json(buildSuccess({ data, provider: { name: 'layerswap' }, traceId: tid, latencyMs: Date.now() - start }));
    } catch (e) {
      wrapError(e, tid, res);
    }
  });

  // POST /v1/capability/bridge/quote
  router.post('/bridge/quote', async (req: Request, res: Response, next: NextFunction) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const parsed = QuoteBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw CapabilityError.validation({ capability: 'bridge', message: 'Invalid request body', errors: parsed.error.flatten() });
      }
      const data = await bridgeService.getQuote(parsed.data);
      res.status(200).json(buildSuccess({ data, provider: { name: 'layerswap' }, traceId: tid, latencyMs: Date.now() - start }));
    } catch (e) {
      wrapError(e, tid, res);
    }
  });

  // POST /v1/capability/bridge/transactions
  router.post('/bridge/transactions', async (req: Request, res: Response, next: NextFunction) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const parsed = TransactionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw CapabilityError.validation({ capability: 'bridge', message: 'Invalid request body', errors: parsed.error.flatten() });
      }
      const data = await bridgeService.createTransaction(parsed.data);
      res.status(201).json(buildSuccess({ data, provider: { name: 'layerswap' }, traceId: tid, latencyMs: Date.now() - start }));
    } catch (e) {
      wrapError(e, tid, res);
    }
  });

  // GET /v1/capability/bridge/transactions/:swapId
  router.get('/bridge/transactions/:swapId', async (req: Request, res: Response, next: NextFunction) => {
    const tid = traceId(req);
    const start = Date.now();
    try {
      const swapId = z.string().min(1).parse(req.params.swapId);
      const data = await bridgeService.getStatus(swapId);
      res.status(200).json(buildSuccess({ data, provider: { name: 'layerswap' }, traceId: tid, latencyMs: Date.now() - start }));
    } catch (e) {
      wrapError(e, tid, res);
    }
  });

  return router;
}
