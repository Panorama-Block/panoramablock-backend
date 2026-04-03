import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RepositoryPort } from '../../../../../packages/core/ports/index.js';
import { entityConfigByCollection } from '../../../../../packages/core/entities.js';
import { ValidationError } from '../../../../../packages/core/services/index.js';
import { IdempotencyStore } from '../../../../../packages/infra-prisma/IdempotencyStore.js';
import { persistIdempotentResponse } from '../middlewares/idempotency.js';
import { normalizeGatewayRecord } from '../serialization.js';

const transactSchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(['create', 'update', 'delete']),
        entity: z.string(),
        args: z.record(z.any())
      })
    )
    .min(1)
});

export const createTransactHandler = (
  repository: RepositoryPort,
  idempotencyStore: IdempotencyStore
) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) return;

    let payload: z.infer<typeof transactSchema>;
    try {
      payload = transactSchema.parse(request.body);
    } catch (err) {
      reply.status(400).send({ error: 'validation_error', message: 'Invalid transaction payload' });
      return;
    }

    for (const op of payload.ops) {
      if (!entityConfigByCollection[op.entity]) {
        reply.status(400).send({ error: 'validation_error', message: `Unknown entity ${op.entity}` });
        return;
      }
    }

    try {
      const result = await repository.transact(payload.ops as any, request.ctx);
      const normalized = result.map((item, index) =>
        normalizeGatewayRecord(payload.ops[index]?.entity ?? '', item)
      );
      await persistIdempotentResponse(request, normalized, idempotencyStore);
      reply.send({ data: normalized });
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.status(400).send({ error: 'validation_error', message: err.message });
        return;
      }
      reply.status(500).send({ error: 'internal_server_error' });
    }
  };
};
