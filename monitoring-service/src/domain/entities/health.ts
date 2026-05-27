export interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

export interface ProviderHealthSnapshot {
  capability: string;
  provider: string;
  healthy: boolean;
  latencyP95Ms?: number;
  lastError?: string;
  lastCheckedAt?: string;
}

export interface MetricEntry {
  service: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: string;
}
