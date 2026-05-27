import cors from 'cors';
import express from 'express';
import { MonitoringService, type ServiceEndpoint } from './application/services/monitoring.service';

export interface CreateAppOptions {
  services?: ServiceEndpoint[];
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const services = options.services ?? [
    { name: 'swap', url: process.env.SWAP_API_BASE || 'http://localhost:3002' },
    { name: 'staking', url: process.env.LIDO_API_BASE || 'http://localhost:3004' },
    { name: 'bridge', url: process.env.BRIDGE_API_BASE || 'http://localhost:3005' },
    { name: 'liquidity', url: process.env.LIQUIDITY_API_BASE || 'http://localhost:3006' },
    { name: 'lending', url: process.env.LENDING_API_BASE || 'http://localhost:3007' },
    { name: 'dca', url: process.env.DCA_API_BASE || 'http://localhost:3003' },
  ];

  const monitoring = new MonitoringService(services);

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'monitoring-service', timestamp: new Date().toISOString() });
  });

  app.get('/v1/monitoring/health/services', async (_req, res) => {
    const health = await monitoring.getServiceHealth();
    res.json({ services: health, checkedAt: new Date().toISOString() });
  });

  app.get('/v1/monitoring/health/providers', async (_req, res) => {
    const providers = await monitoring.getProviderHealth();
    res.json({ providers, checkedAt: new Date().toISOString() });
  });

  app.get('/v1/monitoring/health/providers/:capability', async (req, res) => {
    const providers = await monitoring.getProviderHealth(req.params.capability);
    res.json({ providers, checkedAt: new Date().toISOString() });
  });

  return app;
}
