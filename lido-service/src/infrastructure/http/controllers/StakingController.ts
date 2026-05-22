/**
 * StakingController — thin HTTP adapter on top of `StakingCapabilityService`.
 *
 * Parses the request, constructs a `CapabilityRequest<T>`, calls the facade, wraps the result
 * in `CapabilityResponse<T>`. No business logic — that's the facade's job.
 *
 * Card #246 (SPRINT_HUGO.md).
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import {
  CapabilityError,
  buildError,
  buildSuccess,
  type CapabilityRequest,
  type ProviderInfo,
  type Uuid,
} from '@panorama/capability';

import {
  StakingCapabilityService,
  type StakingActionOutcome,
} from '../../../application/services/staking.capability.service';
import type { DiscoveryHandler } from '@panorama/capability';

export interface StakingControllerDeps {
  facade: StakingCapabilityService;
  discoveryHandler: DiscoveryHandler;
}

export class StakingController {
  private readonly facade: StakingCapabilityService;
  private readonly discoveryHandler: DiscoveryHandler;

  constructor(deps: StakingControllerDeps) {
    this.facade = deps.facade;
    this.discoveryHandler = deps.discoveryHandler;
  }

  // -----------------------------------------------------------------------------------------------
  // Endpoints
  // -----------------------------------------------------------------------------------------------

  /** GET /v1/capability/staking/_discovery */
  discovery(req: Request, res: Response): void {
    const result = this.discoveryHandler({ traceId: this.traceFor(req) });
    res.status(200).json(result);
  }

  /** GET /v1/capability/staking/position/:address?asset=ETH */
  async getPosition(req: Request, res: Response): Promise<void> {
    await this.runQuery<{ asset?: string }>(req, res, async (envelope) => {
      const outcome = await this.facade.getPosition(envelope);
      return this.toResponse(outcome, envelope.traceId);
    }, {
      override: {
        userAddress: req.params.address as string,
        payload: req.query.asset ? { asset: req.query.asset as string } : {},
      },
    });
  }

  /** POST /v1/capability/staking/prepare-stake */
  async prepareStake(req: Request, res: Response): Promise<void> {
    await this.runCommand<{ amount: string; asset?: string }>(
      req,
      res,
      async (envelope) => {
        const outcome = await this.facade.prepareStake(envelope);
        return this.toResponse(outcome, envelope.traceId);
      },
    );
  }

  /** POST /v1/capability/staking/prepare-unstake */
  async prepareUnstake(req: Request, res: Response): Promise<void> {
    await this.runCommand<{ amount: string; asset?: string }>(
      req,
      res,
      async (envelope) => {
        const outcome = await this.facade.prepareUnstake(envelope);
        return this.toResponse(outcome, envelope.traceId);
      },
    );
  }

  /** POST /v1/capability/staking/prepare-claim */
  async prepareClaim(req: Request, res: Response): Promise<void> {
    await this.runCommand<{ requestIds?: string[]; asset?: string }>(
      req,
      res,
      async (envelope) => {
        const outcome = await this.facade.prepareClaim(envelope);
        return this.toResponse(outcome, envelope.traceId);
      },
    );
  }

  /** GET /v1/capability/staking/apr?asset=ETH&chainId=1 */
  async getApr(req: Request, res: Response): Promise<void> {
    await this.runQuery<{ asset?: string }>(req, res, async (envelope) => {
      const outcome = await this.facade.getApr(envelope);
      return this.toResponse(outcome, envelope.traceId);
    });
  }

  // -----------------------------------------------------------------------------------------------
  // Request parsing
  // -----------------------------------------------------------------------------------------------

  private async runCommand<TPayload>(
    req: Request,
    res: Response,
    handler: (envelope: CapabilityRequest<TPayload>) => Promise<{
      status: number;
      body: ReturnType<typeof buildSuccess<unknown>> | ReturnType<typeof buildError>;
    }>,
  ): Promise<void> {
    const traceId = this.traceFor(req);
    const start = Date.now();
    try {
      const envelope = this.buildEnvelope<TPayload>(req, traceId, { fromBody: true });
      const { status, body } = await handler(envelope);
      res.status(status).json(body);
    } catch (e) {
      const err = CapabilityError.is(e) ? e : CapabilityError.internal(
        `staking controller error: ${(e as Error).message}`,
        e,
      );
      const errBody = buildError({
        error: err,
        traceId,
        latencyMs: Date.now() - start,
      });
      res.status(err.httpStatus).json(errBody);
    }
  }

  private async runQuery<TPayload>(
    req: Request,
    res: Response,
    handler: (envelope: CapabilityRequest<TPayload>) => Promise<{
      status: number;
      body: ReturnType<typeof buildSuccess<unknown>> | ReturnType<typeof buildError>;
    }>,
    options?: { override?: Partial<CapabilityRequest<TPayload>> },
  ): Promise<void> {
    const traceId = this.traceFor(req);
    const start = Date.now();
    try {
      const envelope = this.buildEnvelope<TPayload>(req, traceId, { fromBody: false, override: options?.override });
      const { status, body } = await handler(envelope);
      res.status(status).json(body);
    } catch (e) {
      const err = CapabilityError.is(e) ? e : CapabilityError.internal(
        `staking controller error: ${(e as Error).message}`,
        e,
      );
      const errBody = buildError({
        error: err,
        traceId,
        latencyMs: Date.now() - start,
      });
      res.status(err.httpStatus).json(errBody);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------------------------

  private toResponse<TData>(
    outcome: StakingActionOutcome<TData>,
    traceId: Uuid,
  ): {
    status: number;
    body: ReturnType<typeof buildSuccess<TData>>;
  } {
    const provider: ProviderInfo = outcome.provider;
    const body = buildSuccess<TData>({
      data: outcome.data,
      provider,
      traceId,
      latencyMs: 0,
      ...(outcome.attempts.length > 0 && {
        attemptedProviders: outcome.attempts.map((a) => ({ name: a.provider, reason: a.reason })),
      }),
    });
    return { status: 200, body };
  }

  private buildEnvelope<TPayload>(
    req: Request,
    traceId: Uuid,
    options: { fromBody: boolean; override?: Partial<CapabilityRequest<TPayload>> },
  ): CapabilityRequest<TPayload> {
    const tenantId =
      (req.headers['x-tenant-id'] as string | undefined) ??
      ((req as { user?: { address?: string } }).user?.address ?? 'anonymous');
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
    const chainId = this.parseChainId(req);
    const userAddressRaw =
      options.fromBody
        ? (req.body?.userAddress as string | undefined)
        : (req.params.address as string | undefined) ??
          (req.query.address as string | undefined);
    if (!userAddressRaw) {
      throw CapabilityError.validation({
        capability: 'staking',
        message: 'userAddress is required (body for POST, :address path or ?address query for GET)',
      });
    }

    const payload = options.fromBody ? (req.body as TPayload) : ({} as TPayload);

    const envelope: CapabilityRequest<TPayload> = {
      tenantId,
      traceId,
      chainId,
      userAddress: userAddressRaw,
      payload,
      ...(idempotencyKey && { idempotencyKey }),
      receivedAt: new Date().toISOString(),
      ...options.override,
    };
    return envelope;
  }

  private parseChainId(req: Request): number {
    const raw = (req.headers['x-chain-id'] as string | undefined)
      ?? (req.body?.chainId as number | string | undefined)
      ?? (req.query.chainId as string | undefined)
      ?? '1';
    const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw CapabilityError.validation({
        capability: 'staking',
        message: `Invalid chainId: ${JSON.stringify(raw)}`,
      });
    }
    return parsed;
  }

  private traceFor(req: Request): Uuid {
    return (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
  }
}
