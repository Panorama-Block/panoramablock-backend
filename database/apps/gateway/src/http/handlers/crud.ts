import { FastifyReply, FastifyRequest } from 'fastify';
import { RepositoryPort } from '../../../../../packages/core/ports/index.js';
import { entityConfigByCollection } from '../../../../../packages/core/entities.js';
import { parseQueryParams } from '../../../../../packages/validation/index.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../../packages/core/services/index.js';
import { ZodError } from 'zod';
import { persistIdempotentResponse } from '../middlewares/idempotency.js';
import { IdempotencyStore } from '../../../../../packages/infra-prisma/IdempotencyStore.js';
import { normalizeGatewayListResponse, normalizeGatewayRecord } from '../serialization.js';

interface EntityParams {
  entity: string;
  id?: string;
}

const resolveConfig = (entity: string) => {
  const config = entityConfigByCollection[entity];
  if (!config) {
    throw new ValidationError(`Unknown entity: ${entity}`);
  }
  return config;
};

export const createCrudHandlers = (
  repository: RepositoryPort,
  idempotencyStore: IdempotencyStore
) => {
  return {
    list: async (request: FastifyRequest<{ Params: EntityParams }>, reply: FastifyReply) => {
      const { entity } = request.params;
      const config = resolveConfig(entity);
      let query;
      try {
        query = parseQueryParams(request.query as Record<string, unknown>, config.filter);
      } catch (err) {
        request.log.warn({ err }, 'Query parsing failed');
        reply.status(400).send({ error: 'invalid_query', message: (err as Error).message });
        return;
      }

      const result = await repository.list(entity, query, request.ctx);
      reply.send(normalizeGatewayListResponse(entity, result));
    },

    get: async (request: FastifyRequest<{ Params: EntityParams }>, reply: FastifyReply) => {
      const { entity, id } = request.params;
      const config = resolveConfig(entity);
      if (!id) {
        reply.status(400).send({ error: 'missing_id', message: 'id path parameter is required' });
        return;
      }

      const result = await repository.get(entity, id, request.ctx);
      if (!result) {
        reply.status(404).send({ error: 'not_found', message: `${config.collection} not found` });
        return;
      }
      reply.send(normalizeGatewayRecord(entity, result));
    },

    create: async (request: FastifyRequest<{ Params: EntityParams }>, reply: FastifyReply) => {
      if (reply.sent) return;
      const { entity } = request.params;
      const config = resolveConfig(entity);
      try {
        const payload = config.create.parse(request.body);
        const result = await repository.create(entity, payload, request.ctx);
        const normalized = normalizeGatewayRecord(entity, result);
        await persistIdempotentResponse(request, normalized, idempotencyStore);
        reply.status(201).send(normalized);
      } catch (err) {
        handleError(err, reply, config.collection);
      }
    },

    update: async (request: FastifyRequest<{ Params: EntityParams }>, reply: FastifyReply) => {
      if (reply.sent) return;
      const { entity, id } = request.params;
      const config = resolveConfig(entity);
      if (!id) {
        reply.status(400).send({ error: 'missing_id', message: 'id path parameter is required' });
        return;
      }
      try {
        const payload = config.update.parse(request.body);
        const result = await repository.update(entity, id, payload, request.ctx);
        const normalized = normalizeGatewayRecord(entity, result);
        await persistIdempotentResponse(request, normalized, idempotencyStore);
        reply.send(normalized);
      } catch (err) {
        handleError(err, reply, config.collection);
      }
    },

    delete: async (request: FastifyRequest<{ Params: EntityParams }>, reply: FastifyReply) => {
      if (reply.sent) return;
      const { entity, id } = request.params;
      const config = resolveConfig(entity);
      if (!id) {
        reply.status(400).send({ error: 'missing_id', message: 'id path parameter is required' });
        return;
      }
      try {
        await repository.delete(entity, id, request.ctx);
        await persistIdempotentResponse(request, { status: 'deleted' }, idempotencyStore);
        reply.status(204).send();
      } catch (err) {
        handleError(err, reply, config.collection);
      }
    }
  };
};

const handleError = (err: unknown, reply: FastifyReply, collection: string) => {
  if (reply.sent) return;
  if (err instanceof ZodError) {
    reply.status(400).send({ error: 'validation_error', message: err.message, details: err.flatten?.() });
    return;
  }
  if (err instanceof ValidationError) {
    reply.status(400).send({ error: 'validation_error', message: err.message });
    return;
  }
  if (err instanceof NotFoundError || (err as any).name === 'NotFoundError') {
    reply
      .status(404)
      .send({ error: 'not_found', message: `${collection} not found or not accessible` });
    return;
  }
  if (err instanceof ForbiddenError || (err as any).name === 'ForbiddenError') {
    reply.status(403).send({ error: 'forbidden', message: err instanceof Error ? err.message : '' });
    return;
  }
  reply.status(500).send({ error: 'internal_server_error' });
};
