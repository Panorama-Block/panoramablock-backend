import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  buildSuccess,
  buildError,
  CapabilityError,
  ErrorCategory,
} from '@panorama/capability';
import type { AuthCapabilityService } from '../application/services/auth.capability.service';

function traceId(req: Request): string {
  return (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
}

function elapsed(start: number): number {
  return Date.now() - start;
}

export function capabilityRouter(service: AuthCapabilityService): Router {
  const router = Router();

  // GET /v1/capability/_discovery
  router.get('/_discovery', (req: Request, res: Response) => {
    const result = service.discoveryHandler({ traceId: traceId(req) });
    res.status(200).json(result);
  });

  // POST /v1/capability/auth/login
  // Generates an EVM wallet challenge (SIWE payload) for the given address.
  router.post('/auth/login', async (req: Request, res: Response) => {
    const start = Date.now();
    const tid = traceId(req);
    try {
      const { address } = req.body as { address?: string };
      if (!address) {
        return res.status(400).json(
          buildError({
            error: new CapabilityError({
              code: 'CAPABILITY_AUTH_MISSING_ADDRESS',
              category: ErrorCategory.VALIDATION,
              message: 'address is required',
            }),
            traceId: tid,
            latencyMs: elapsed(start),
          }),
        );
      }
      const challenge = await service.login(address);
      return res.status(200).json(
        buildSuccess({
          data: challenge,
          provider: { name: 'thirdweb' },
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    } catch (err: any) {
      return res.status(503).json(
        buildError({
          error: new CapabilityError({
            code: 'CAPABILITY_AUTH_LOGIN_FAILED',
            category: ErrorCategory.UNAVAILABLE,
            message: err.message,
            cause: err,
          }),
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    }
  });

  // POST /v1/capability/auth/verify
  // Verifies an ECDSA signature against the previously issued challenge and returns a JWT.
  router.post('/auth/verify', async (req: Request, res: Response) => {
    const start = Date.now();
    const tid = traceId(req);
    try {
      const { payload, signature } = req.body as { payload?: unknown; signature?: string };
      if (!payload || !signature) {
        return res.status(400).json(
          buildError({
            error: new CapabilityError({
              code: 'CAPABILITY_AUTH_MISSING_FIELDS',
              category: ErrorCategory.VALIDATION,
              message: 'payload and signature are required',
            }),
            traceId: tid,
            latencyMs: elapsed(start),
          }),
        );
      }
      const result = await service.verify(payload, signature);
      return res.status(200).json(
        buildSuccess({
          data: result,
          provider: { name: 'thirdweb' },
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    } catch (err: any) {
      return res.status(401).json(
        buildError({
          error: new CapabilityError({
            code: 'CAPABILITY_AUTH_VERIFY_FAILED',
            category: ErrorCategory.VALIDATION,
            message: err.message,
            httpStatus: 401,
            cause: err,
          }),
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    }
  });

  // POST /v1/capability/auth/telegram/exchange
  // Validates Telegram WebApp initData (HMAC-SHA256) and returns a Panorama JWT.
  router.post('/auth/telegram/exchange', async (req: Request, res: Response) => {
    const start = Date.now();
    const tid = traceId(req);
    try {
      const { init_data: initData } = req.body as { init_data?: string };
      if (!initData) {
        return res.status(400).json(
          buildError({
            error: new CapabilityError({
              code: 'CAPABILITY_AUTH_MISSING_INIT_DATA',
              category: ErrorCategory.VALIDATION,
              message: 'init_data is required',
            }),
            traceId: tid,
            latencyMs: elapsed(start),
          }),
        );
      }
      const result = await service.exchangeTelegramJWT(initData);
      return res.status(200).json(
        buildSuccess({
          data: result,
          provider: { name: 'telegram' },
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    } catch (err: any) {
      return res.status(401).json(
        buildError({
          error: new CapabilityError({
            code: 'CAPABILITY_AUTH_TELEGRAM_EXCHANGE_FAILED',
            category: ErrorCategory.VALIDATION,
            message: err.message,
            httpStatus: 401,
            cause: err,
          }),
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    }
  });

  // POST /v1/capability/auth/telegram/register
  // Stores the telegram_user_id → zico_user_id identity mapping and issues a JWT.
  router.post('/auth/telegram/register', async (req: Request, res: Response) => {
    const start = Date.now();
    const tid = traceId(req);
    try {
      const {
        telegram_user_id,
        zico_user_id,
        session_id,
        address,
        source,
      } = req.body as {
        telegram_user_id?: string;
        zico_user_id?: string;
        session_id?: string;
        address?: string;
        source?: string;
      };

      if (!telegram_user_id || !zico_user_id) {
        return res.status(400).json(
          buildError({
            error: new CapabilityError({
              code: 'CAPABILITY_AUTH_MISSING_FIELDS',
              category: ErrorCategory.VALIDATION,
              message: 'telegram_user_id and zico_user_id are required',
            }),
            traceId: tid,
            latencyMs: elapsed(start),
          }),
        );
      }

      const result = await service.registerTelegram(telegram_user_id, zico_user_id, {
        sessionId: session_id,
        address,
        source,
      });

      return res.status(200).json(
        buildSuccess({
          data: result,
          provider: { name: 'telegram' },
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    } catch (err: any) {
      return res.status(500).json(
        buildError({
          error: CapabilityError.internal(err.message, err),
          traceId: tid,
          latencyMs: elapsed(start),
        }),
      );
    }
  });

  return router;
}
