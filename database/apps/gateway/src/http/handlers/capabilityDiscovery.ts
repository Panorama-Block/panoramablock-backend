import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

interface CapabilityRow {
  capability: string | null;
  provider: string | null;
  count: bigint;
}

interface ProviderVolume {
  provider: string;
  count: number;
}

interface CapabilityEntry {
  capability: string;
  totalCount: number;
  providers: ProviderVolume[];
}

interface DiscoveryResponse {
  capabilities: CapabilityEntry[];
  totalAudited: number;
  generatedAt: string;
}

export const createCapabilityDiscoveryHandler = (prisma: PrismaClient) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const rows = await prisma.$queryRaw<CapabilityRow[]>`
      SELECT
        "capability",
        "provider",
        COUNT(*) AS count
      FROM "Transaction"
      WHERE "capability" IS NOT NULL
      GROUP BY "capability", "provider"
      ORDER BY "capability", count DESC
    `;

    const capabilityMap = new Map<string, CapabilityEntry>();

    for (const row of rows) {
      const cap = row.capability ?? 'unknown';
      const prov = row.provider ?? 'unknown';
      const n = Number(row.count);

      if (!capabilityMap.has(cap)) {
        capabilityMap.set(cap, { capability: cap, totalCount: 0, providers: [] });
      }

      const entry = capabilityMap.get(cap)!;
      entry.totalCount += n;
      entry.providers.push({ provider: prov, count: n });
    }

    const capabilities = Array.from(capabilityMap.values()).sort(
      (a, b) => b.totalCount - a.totalCount
    );

    const totalAudited = capabilities.reduce((sum, c) => sum + c.totalCount, 0);

    const response: DiscoveryResponse = {
      capabilities,
      totalAudited,
      generatedAt: new Date().toISOString()
    };

    reply.send(response);
  };
};
