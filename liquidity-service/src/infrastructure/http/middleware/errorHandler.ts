/**
 * Minimal Express error middleware + async wrapper.
 *
 * Adapted from `lido-service/src/infrastructure/http/middleware/errorHandler.ts` —
 * stripped of project-specific logger/error-code modules so the scaffold runs standalone.
 * Replace with the shared logger when one is introduced.
 */

import type { NextFunction, Request, Response } from 'express';

import { CapabilityError, buildError } from '@panorama/capability';

export class ErrorHandler {
  static handle(
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void {
    if (CapabilityError.is(error)) {
      res
        .status(error.httpStatus)
        .json(buildError({ error, traceId: 'unknown', latencyMs: 0 }));
      return;
    }

    // eslint-disable-next-line no-console
    console.error('[liquidity-service] Unhandled error', {
      message: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        category: 'INTERNAL',
        message:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
        httpStatus: 500,
      },
    });
  }

  static asyncWrapper(
    fn: (req: Request, res: Response, next: NextFunction) => unknown
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}
