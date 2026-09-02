import { describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaRepository } from '../../../packages/infra-prisma/PrismaRepository.js';

describe('PrismaRepository list orderBy normalization', () => {
  it('converts multi-field orderBy records to Prisma order arrays', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    const prisma = {
      user: {
        findMany
      }
    } as unknown as PrismaClient;

    const repository = new PrismaRepository(prisma);

    await repository.list(
      'users',
      {
        orderBy: {
          createdAt: 'desc',
          userId: 'asc'
        },
        take: 1000,
        skip: 0
      },
      {
        requestId: 'orderby-regression-test',
        tenantId: 'panorama-default'
      }
    );

    expect(findMany).toHaveBeenCalledOnce();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'panorama-default'
        },
        orderBy: [
          { createdAt: 'desc' },
          { userId: 'asc' }
        ],
        take: 1000,
        skip: 0
      })
    );
  });

  it('preserves a single-field orderBy as a Prisma object', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    const prisma = {
      user: {
        findMany
      }
    } as unknown as PrismaClient;

    const repository = new PrismaRepository(prisma);

    await repository.list(
      'users',
      {
        orderBy: {
          createdAt: 'desc'
        }
      },
      {
        requestId: 'orderby-single-field-test',
        tenantId: 'panorama-default'
      }
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: {
          createdAt: 'desc'
        }
      })
    );
  });
});
