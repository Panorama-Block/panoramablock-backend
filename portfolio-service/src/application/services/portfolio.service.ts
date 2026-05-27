import axios from 'axios';
import type { PortfolioSummary, CapabilityPosition, PositionEntry } from '../../domain/entities/portfolio';

export interface CapabilityEndpoint {
  capability: string;
  url: string;
  positionPath: string;
}

export class PortfolioService {
  constructor(private readonly endpoints: CapabilityEndpoint[]) {}

  async getPortfolio(userAddress: string, chainId?: number): Promise<PortfolioSummary> {
    const results = await Promise.allSettled(
      this.endpoints.map((ep) => this.fetchPositions(ep, userAddress, chainId))
    );

    const capabilities: CapabilityPosition[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) capabilities.push(r.value);
    }

    return {
      userAddress,
      chainId,
      capabilities,
      totalValueUsd: capabilities.reduce((sum, c) => sum + c.totalValueUsd, 0),
      generatedAt: new Date().toISOString(),
    };
  }

  async getPositionsByCapability(
    userAddress: string,
    capability: string,
    chainId?: number
  ): Promise<CapabilityPosition | null> {
    const ep = this.endpoints.find((e) => e.capability === capability);
    if (!ep) return null;
    return this.fetchPositions(ep, userAddress, chainId);
  }

  private async fetchPositions(
    ep: CapabilityEndpoint,
    userAddress: string,
    chainId?: number
  ): Promise<CapabilityPosition> {
    try {
      const url = `${ep.url}${ep.positionPath.replace(':address', userAddress)}`;
      const params = chainId ? { chainId: String(chainId) } : {};
      const res = await axios.get(url, { params, timeout: 10000 });
      const data = res.data?.data ?? res.data;
      const positions: PositionEntry[] = Array.isArray(data)
        ? data.map((p: any) => ({
            capability: ep.capability,
            provider: p.provider ?? 'unknown',
            chainId: p.chainId ?? chainId ?? 0,
            asset: p.asset ?? p.poolId ?? 'unknown',
            balanceWei: p.balanceWei ?? p.lpBalanceWei ?? '0',
            valueUsd: p.valueUsd,
            metadata: p.metadata ?? p.extra,
          }))
        : [];

      return {
        capability: ep.capability,
        positions,
        totalValueUsd: positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0),
      };
    } catch {
      return { capability: ep.capability, positions: [], totalValueUsd: 0 };
    }
  }
}
