/**
 * LiquidityController — thin HTTP adapter on top of `LiquidityCapabilityService`.
 *
 * Card #252. Parses Express request → `CapabilityRequest<T>`, calls the facade, wraps the
 * result in `CapabilityResponse<T>`. Zero business logic — that's the facade's job.
 *
 * Mirrors `lido-service/src/infrastructure/http/controllers/StakingController.ts`.
 */

import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import { z } from 'zod';

import {
  CapabilityError,
  buildError,
  buildSuccess,
  type CapabilityRequest,
  type DiscoveryHandler,
  type ProviderInfo,
  type Uuid,
} from '@panorama/capability';

import type {
  GetPoolsFilter,
  Pool,
} from '../../../domain/entities/pool';
import type {
  LiquidityActionOutcome,
  LiquidityCapabilityService,
} from '../../../application/services/liquidity.capability.service';

// -------------------------------------------------------------------------------------------------
// Zod schemas — validate body payloads before they cross into the application layer
// -------------------------------------------------------------------------------------------------

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'address must be 0x-prefixed 20-byte hex');

const weiStringSchema = z
  .string()
  .regex(/^\d+$/, 'amount must be a non-negative decimal string (wei)');

const prepareAddBodySchema = z.object({
  userAddress: addressSchema,
  chainId: z.number().int().positive(),
  poolId: z.string().min(1),
  amounts: z.tuple([weiStringSchema, weiStringSchema]),
  stake: z.boolean().optional(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
});

const prepareRemoveBodySchema = z.object({
  userAddress: addressSchema,
  chainId: z.number().int().positive(),
  poolId: z.string().min(1),
  lpAmountWei: weiStringSchema,
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  unstakeFirst: z.boolean().optional(),
});

const prepareClaimBodySchema = z.object({
  userAddress: addressSchema,
  chainId: z.number().int().positive(),
  poolId: z.string().min(1),
  rewardAssets: z.array(addressSchema).optional(),
});

// -------------------------------------------------------------------------------------------------
// Controller
// -------------------------------------------------------------------------------------------------

export interface LiquidityControllerDeps {
  facade: LiquidityCapabilityService;
  discoveryHandler: DiscoveryHandler;
}

export class LiquidityController {
  private readonly facade: LiquidityCapabilityService;
  private readonly discoveryHandler: DiscoveryHandler;

  constructor(deps: LiquidityControllerDeps) {
    this.facade = deps.facade;
    this.discoveryHandler = deps.discoveryHandler;
  }

  /** GET /v1/capability/liquidity/_discovery */
  discovery(req: Request, res: Response): void {
    const result = this.discoveryHandler({ traceId: this.traceFor(req) });
    res.status(200).json(result);
  }

  /** GET /v1/capability/liquidity/pools?chainId=8453&type=stable&asset=0x... */
  async getPools(req: Request, res: Response): Promise<void> {
    await this.run<GetPoolsFilter, Pool[]>(req, res, async (envelope) => {
      const outcome = await this.facade.getPools(envelope);
      return this.toResponse(outcome, envelope.traceId);
    }, () => {
      const chainId = this.parseChainId(req);
      const payload: GetPoolsFilter = {
        chainId,
        ...(req.query.type && { type: req.query.type as GetPoolsFilter['type'] }),
        ...(req.query.asset && { asset: req.query.asset as string }),
        ...(req.query.limit && { limit: Number(req.query.limit) }),
        ...(req.query.cursor && { cursor: req.query.cursor as string }),
      };
      return { chainId, userAddress: '0x0000000000000000000000000000000000000000', payload };
    });
  }

  /** GET /v1/capability/liquidity/position/:address/:poolId?chainId=8453 */
  async getPosition(req: Request, res: Response): Promise<void> {
    await this.run<{ poolId: string }, unknown>(req, res, async (envelope) => {
      const outcome = await this.facade.getPosition(envelope);
      return this.toResponse(outcome, envelope.traceId);
    }, () => {
      const address = req.params.address;
      const poolId = req.params.poolId;
      if (!address || !poolId) {
        throw CapabilityError.validation({
          capability: 'liquidity',
          message: 'address and poolId are required (path params)',
        });
      }
      return {
        chainId: this.parseChainId(req),
        userAddress: address,
        payload: { poolId },
      };
    });
  }

  /** GET /v1/capability/liquidity/apr/:poolId?chainId=8453 */
  async getApr(req: Request, res: Response): Promise<void> {
    await this.run<{ poolId: string }, unknown>(req, res, async (envelope) => {
      const outcome = await this.facade.getApr(envelope);
      return this.toResponse(outcome, envelope.traceId);
    }, () => {
      const poolId = req.params.poolId;
      if (!poolId) {
        throw CapabilityError.validation({
          capability: 'liquidity',
          message: 'poolId is required (path param)',
        });
      }
      return {
        chainId: this.parseChainId(req),
        userAddress: '0x0000000000000000000000000000000000000000',
        payload: { poolId },
      };
    });
  }

  /** POST /v1/capability/liquidity/prepare-add */
  async prepareAdd(req: Request, res: Response): Promise<void> {
    await this.runBody(req, res, prepareAddBodySchema, async (envelope) => {
      const outcome = await this.facade.prepareAdd(envelope);
      return this.toResponse(outcome, envelope.traceId);
    });
  }

  /** POST /v1/capability/liquidity/prepare-remove */
  async prepareRemove(req: Request, res: Response): Promise<void> {
    await this.runBody(req, res, prepareRemoveBodySchema, async (envelope) => {
      const outcome = await this.facade.prepareRemove(envelope);
      return this.toResponse(outcome, envelope.traceId);
    });
  }

  /** POST /v1/capability/liquidity/prepare-claim */
  async prepareClaim(req: Request, res: Response): Promise<void> {
    await this.runBody(req, res, prepareClaimBodySchema, async (envelope) => {
      const outcome = await this.facade.prepareClaim(envelope);
      return this.toResponse(outcome, envelope.traceId);
    });
  }

  // -----------------------------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------------------------

  private async run<TPayload, _TData>(
    req: Request,
    res: Response,
    handler: (envelope: CapabilityRequest<TPayload>) => Promise<{
      status: number;
      body: ReturnType<typeof buildSuccess<unknown>> | ReturnType<typeof buildError>;
    }>,
    buildEnvelope: () => {
      chainId: number;
      userAddress: string;
      payload: TPayload;
    }
  ): Promise<void> {
    const traceId = this.traceFor(req);
    const start = Date.now();
    try {
      const parts = buildEnvelope();
      const envelope: CapabilityRequest<TPayload> = {
        tenantId: this.tenantFor(req, parts.userAddress),
        traceId,
        chainId: parts.chainId,
        userAddress: parts.userAddress,
        payload: parts.payload,
        receivedAt: new Date().toISOString(),
        ...(req.headers['x-idempotency-key'] && {
          idempotencyKey: req.headers['x-idempotency-key'] as string,
        }),
      };
      const { status, body } = await handler(envelope);
      res.status(status).json(body);
    } catch (e) {
      const err = CapabilityError.is(e)
        ? e
        : CapabilityError.internal(
            `liquidity controller error: ${(e as Error).message}`,
            e
          );
      res
        .status(err.httpStatus)
        .json(buildError({ error: err, traceId, latencyMs: Date.now() - start }));
    }
  }

  private async runBody<TSchema extends z.ZodTypeAny>(
    req: Request,
    res: Response,
    schema: TSchema,
    handler: (envelope: CapabilityRequest<z.infer<TSchema>>) => Promise<{
      status: number;
      body: ReturnType<typeof buildSuccess<unknown>> | ReturnType<typeof buildError>;
    }>
  ): Promise<void> {
    const traceId = this.traceFor(req);
    const start = Date.now();
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        throw CapabilityError.validation({
          capability: 'liquidity',
          message: 'Invalid request body',
          errors: parsed.error.flatten(),
        });
      }
      const body = parsed.data as {
        userAddress: string;
        chainId: number;
        [k: string]: unknown;
      };
      const envelope: CapabilityRequest<z.infer<TSchema>> = {
        tenantId: this.tenantFor(req, body.userAddress),
        traceId,
        chainId: body.chainId,
        userAddress: body.userAddress,
        payload: body as z.infer<TSchema>,
        receivedAt: new Date().toISOString(),
        ...(req.headers['x-idempotency-key'] && {
          idempotencyKey: req.headers['x-idempotency-key'] as string,
        }),
      };
      const { status, body: responseBody } = await handler(envelope);
      res.status(status).json(responseBody);
    } catch (e) {
      const err = CapabilityError.is(e)
        ? e
        : CapabilityError.internal(
            `liquidity controller error: ${(e as Error).message}`,
            e
          );
      res
        .status(err.httpStatus)
        .json(buildError({ error: err, traceId, latencyMs: Date.now() - start }));
    }
  }

  private toResponse<TData>(
    outcome: LiquidityActionOutcome<TData>,
    traceId: Uuid
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
        attemptedProviders: outcome.attempts.map((a) => ({
          name: a.provider,
          reason: a.reason,
        })),
      }),
    });
    return { status: 200, body };
  }

  private parseChainId(req: Request): number {
    const raw =
      (req.headers['x-chain-id'] as string | undefined) ??
      (req.body?.chainId as number | string | undefined) ??
      (req.query.chainId as string | undefined);
    if (raw === undefined) {
      throw CapabilityError.validation({
        capability: 'liquidity',
        message: 'chainId is required (header x-chain-id, body.chainId, or ?chainId)',
      });
    }
    const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw CapabilityError.validation({
        capability: 'liquidity',
        message: `Invalid chainId: ${JSON.stringify(raw)}`,
      });
    }
    return parsed;
  }

  private traceFor(req: Request): Uuid {
    return (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
  }

  private tenantFor(req: Request, userAddress: string): string {
    return (
      (req.headers['x-tenant-id'] as string | undefined) ??
      userAddress?.toLowerCase() ??
      'anonymous'
    );
  }
}
