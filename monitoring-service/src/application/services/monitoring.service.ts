import axios from 'axios';
import type { ServiceHealth, ProviderHealthSnapshot } from '../../domain/entities/health';

export interface ServiceEndpoint {
  name: string;
  url: string;
}

export class MonitoringService {
  constructor(private readonly services: ServiceEndpoint[]) {}

  async getServiceHealth(): Promise<ServiceHealth[]> {
    const results = await Promise.allSettled(
      this.services.map(async (svc) => {
        const start = Date.now();
        try {
          const res = await axios.get(`${svc.url}/health`, { timeout: 5000 });
          return {
            name: svc.name, url: svc.url, healthy: res.status === 200,
            latencyMs: Date.now() - start, checkedAt: new Date().toISOString(),
          } as ServiceHealth;
        } catch (e) {
          return {
            name: svc.name, url: svc.url, healthy: false,
            latencyMs: Date.now() - start, error: (e as Error).message,
            checkedAt: new Date().toISOString(),
          } as ServiceHealth;
        }
      })
    );
    return results.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { name: 'unknown', url: '', healthy: false, error: String(r.reason), checkedAt: new Date().toISOString() }
    );
  }

  async getProviderHealth(capability?: string): Promise<ProviderHealthSnapshot[]> {
    const snapshots: ProviderHealthSnapshot[] = [];
    const results = await Promise.allSettled(
      this.services.map(async (svc) => {
        try {
          const res = await axios.get(`${svc.url}/v1/capability/${svc.name}/_discovery`, { timeout: 5000 });
          const data = res.data?.data ?? res.data;
          for (const cap of data?.capabilities ?? []) {
            if (capability && cap.capability !== capability) continue;
            for (const [, providers] of Object.entries(cap.byChain ?? {})) {
              for (const p of providers as any[]) {
                snapshots.push({
                  capability: cap.capability, provider: p.provider,
                  healthy: p.healthy, latencyP95Ms: p.latencyP95Ms,
                  lastError: p.lastError, lastCheckedAt: p.lastCheckedAt,
                });
              }
            }
          }
        } catch { /* skip unreachable services */ }
      })
    );
    return snapshots;
  }
}
