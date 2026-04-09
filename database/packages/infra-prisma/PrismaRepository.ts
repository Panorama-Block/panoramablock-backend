import { Prisma, PrismaClient } from '@prisma/client';
import { entityConfigByCollection, EntityConfig } from '../core/entities.js';
import { decodeCompositeId } from '../core/compositeId.js';
import {
  ensureAuthorized,
  ForbiddenError,
  NotFoundError,
  ValidationError
} from '../core/services/index.js';
import { Query, RepositoryPort, RequestCtx, TransactionOp } from '../core/ports/index.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const getDelegate = (executor: PrismaExecutor, model: string): any => {
  const delegateKey = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = (executor as any)[delegateKey];
  if (!delegate) {
    throw new Error(`Prisma delegate not found for model ${model}`);
  }
  return delegate;
};

const ensureTenant = (config: EntityConfig, ctx: RequestCtx): string | undefined => {
  if (!config.tenantField) {
    return undefined;
  }

  const tenantId = ctx.tenantId;
  if (!tenantId) {
    throw new ForbiddenError(`Tenant scope required for ${config.collection}`);
  }

  return tenantId;
};

const buildUniqueWhere = (config: EntityConfig, id: unknown): Record<string, unknown> => {
  if (config.primaryKeys.length === 0) {
    throw new Error(`Entity ${config.collection} missing primary key metadata`);
  }

  const [primaryKey] = config.primaryKeys;
  if (config.primaryKeys.length === 1) {
    if (typeof id === 'object' && id !== null) {
      const value = (id as Record<string, unknown>)[primaryKey];
      if (value === undefined) {
        throw new ValidationError(`Missing identifier: ${primaryKey}`);
      }
      return { [primaryKey]: value as any };
    }
    return { [primaryKey]: id as any };
  }

  let components: Record<string, string | number | boolean>;
  if (typeof id === 'string') {
    let parts: string[];
    try {
      parts = decodeCompositeId(id, config.primaryKeys.length);
    } catch {
      throw new ValidationError('Invalid composite identifier');
    }
    components = Object.fromEntries(
      config.primaryKeys.map((key, idx) => [key, parts[idx] as string | number | boolean])
    );
  } else if (typeof id === 'object' && id !== null) {
    const payload = id as Record<string, unknown>;
    const missing = config.primaryKeys.filter((key) => payload[key] === undefined);
    if (missing.length > 0) {
      throw new ValidationError(`Missing identifier fields: ${missing.join(', ')}`);
    }
    components = Object.fromEntries(
      config.primaryKeys.map((key) => [key, payload[key] as string | number | boolean])
    );
  } else {
    throw new ValidationError('Unsupported identifier shape');
  }

  const compositeKey = config.primaryKeys.join('_');
  return { [compositeKey]: components };
};

const mergeTenantWhere = (
  config: EntityConfig,
  ctx: RequestCtx,
  where: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (!config.tenantField) {
    return where;
  }
  const tenantId = ensureTenant(config, ctx);
  return {
    ...where,
    [config.tenantField]: tenantId
  };
};

const pickNextCursor = (
  config: EntityConfig,
  data: any[],
  take?: number
): Record<string, unknown> | null => {
  if (!take || data.length < take) {
    return null;
  }
  if (config.primaryKeys.length === 1) {
    const last = data[data.length - 1];
    const key = config.primaryKeys[0];
    return { [key]: last?.[key] };
  }
  const last = data[data.length - 1];
  const cursor: Record<string, unknown> = {};
  for (const key of config.primaryKeys) {
    cursor[key] = last?.[key];
  }
  return cursor;
};

const sanitizeData = (
  config: EntityConfig,
  ctx: RequestCtx,
  data: Record<string, unknown>,
  action: 'create' | 'update'
): Record<string, unknown> => {
  const payload = { ...data };
  if (config.tenantField) {
    const tenantId = ensureTenant(config, ctx);
    if (action === 'create') {
      payload[config.tenantField] = tenantId;
    } else if (payload[config.tenantField] && payload[config.tenantField] !== tenantId) {
      throw new ForbiddenError('Cannot change tenant assignment');
    }
  }
  return payload;
};

const ensureOwnership = async (
  executor: PrismaExecutor,
  config: EntityConfig,
  where: Record<string, unknown>,
  ctx: RequestCtx
): Promise<void> => {
  if (!config.tenantField) {
    return;
  }
  const delegate = getDelegate(executor, config.model);
  const existing = await delegate.findUnique({ where });
  if (!existing) {
    throw new NotFoundError(`${config.collection} not found`);
  }
  const tenantId = ensureTenant(config, ctx);
  if (existing[config.tenantField] !== tenantId) {
    throw new NotFoundError(`${config.collection} not found`);
  }
};

const recordOutbox = async (
  executor: PrismaExecutor,
  entity: string,
  op: string,
  payload: unknown
): Promise<void> => {
  await (executor as any).outbox.create({
    data: {
      entity,
      op,
      payload
    }
  });
};

export class PrismaRepository implements RepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  private getConfig(entity: string): EntityConfig {
    const config = entityConfigByCollection[entity];
    if (!config) {
      throw new ValidationError(`Unknown entity: ${entity}`);
    }
    return config;
  }

  async list(entity: string, q: Query, ctx: RequestCtx): Promise<{ data: any[]; page?: any }> {
    const config = this.getConfig(entity);
    ensureAuthorized(config, 'list', ctx);
    const delegate = getDelegate(this.prisma, config.model);
    const where = mergeTenantWhere(config, ctx, q.where);

    const orderBy = q.orderBy ?? config.defaultOrderBy;
    const data = await delegate.findMany({
      where,
      select: Array.isArray(q.select)
        ? q.select.reduce<Record<string, boolean>>((acc, field) => {
            acc[field] = true;
            return acc;
          }, {})
        : q.select,
      include: q.include,
      orderBy,
      cursor: q.cursor,
      take: q.take,
      skip: q.skip,
      distinct: q.distinct
    });

    const page = q.take
      ? {
          take: q.take,
          skip: q.skip ?? 0,
          nextCursor: pickNextCursor(config, data, q.take)
        }
      : undefined;

    return { data, page };
  }

  async get(entity: string, id: any, ctx: RequestCtx): Promise<any | null> {
    const config = this.getConfig(entity);
    ensureAuthorized(config, 'get', ctx);
    const delegate = getDelegate(this.prisma, config.model);
    const where = buildUniqueWhere(config, id);

    const record = await delegate.findUnique({ where });
    if (!record) {
      return null;
    }

    if (config.tenantField) {
      const tenantId = ensureTenant(config, ctx);
      if (record[config.tenantField] !== tenantId) {
        return null;
      }
    }

    return record;
  }

  async create(entity: string, data: Record<string, unknown>, ctx: RequestCtx): Promise<any> {
    const config = this.getConfig(entity);
    ensureAuthorized(config, 'create', ctx);
    const payload = sanitizeData(config, ctx, data, 'create');

    return await this.prisma.$transaction(async (tx) => {
      const delegate = getDelegate(tx, config.model);
      const record = await delegate.create({ data: payload });
      await recordOutbox(tx, entity, 'create', record);
      return record;
    });
  }

  async update(entity: string, id: any, data: Record<string, unknown>, ctx: RequestCtx): Promise<any> {
    const config = this.getConfig(entity);
    ensureAuthorized(config, 'update', ctx);
    const payload = sanitizeData(config, ctx, data, 'update');
    const where = buildUniqueWhere(config, id);

    return await this.prisma.$transaction(async (tx) => {
      await ensureOwnership(tx, config, where, ctx);
      const delegate = getDelegate(tx, config.model);
      const record = await delegate.update({ where, data: payload });
      await recordOutbox(tx, entity, 'update', record);
      return record;
    });
  }

  async delete(entity: string, id: any, ctx: RequestCtx): Promise<void> {
    const config = this.getConfig(entity);
    ensureAuthorized(config, 'delete', ctx);
    const where = buildUniqueWhere(config, id);

    await this.prisma.$transaction(async (tx) => {
      await ensureOwnership(tx, config, where, ctx);
      const delegate = getDelegate(tx, config.model);
      const record = await delegate.delete({ where });
      await recordOutbox(tx, entity, 'delete', record);
    });
  }

  async transact(ops: TransactionOp[], ctx: RequestCtx): Promise<any[]> {
    return await this.prisma.$transaction(async (tx) => {
      const results: any[] = [];
      for (const op of ops) {
        const config = this.getConfig(op.entity);
        ensureAuthorized(config, 'transact', ctx);
        switch (op.op) {
          case 'create': {
            const payload = sanitizeData(config, ctx, op.args.data, 'create');
            const delegate = getDelegate(tx, config.model);
            const record = await delegate.create({ data: payload });
            await recordOutbox(tx, op.entity, 'create', record);
            results.push(record);
            break;
          }
          case 'update': {
            const payload = sanitizeData(config, ctx, op.args.data, 'update');
            const where = buildUniqueWhere(config, op.args.id);
            await ensureOwnership(tx, config, where, ctx);
            const delegate = getDelegate(tx, config.model);
            const record = await delegate.update({ where, data: payload });
            await recordOutbox(tx, op.entity, 'update', record);
            results.push(record);
            break;
          }
          case 'delete': {
            const where = buildUniqueWhere(config, op.args.id);
            await ensureOwnership(tx, config, where, ctx);
            const delegate = getDelegate(tx, config.model);
            const record = await delegate.delete({ where });
            await recordOutbox(tx, op.entity, 'delete', record);
            results.push(record);
            break;
          }
          default:
            throw new ValidationError(`Unsupported transaction op: ${(op as any).op}`);
        }
      }
      return results;
    });
  }

  async searchEmbedding(
    entity: string,
    embedding: number[],
    k: number,
    filter: Record<string, unknown> = {},
    ctx?: RequestCtx
  ): Promise<any[]> {
    const config = this.getConfig(entity);
    if (!ctx) {
      throw new ForbiddenError('Tenant context required');
    }
    ensureAuthorized(config, 'list', ctx);
    const where = mergeTenantWhere(config, ctx, filter);

    // Placeholder implementation – pgvector integration pending.
    const delegate = getDelegate(this.prisma, config.model);
    return await delegate.findMany({
      where,
      take: k ?? 10
    });
  }
}
