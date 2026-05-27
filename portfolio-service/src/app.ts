import cors from 'cors';
import express from 'express';
import { PortfolioService, type CapabilityEndpoint } from './application/services/portfolio.service';

export interface CreateAppOptions {
  endpoints?: CapabilityEndpoint[];
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const endpoints = options.endpoints ?? [
    { capability: 'staking', url: process.env.LIDO_API_BASE || 'http://localhost:3004', positionPath: '/v1/capability/staking/position/:address' },
    { capability: 'liquidity', url: process.env.LIQUIDITY_API_BASE || 'http://localhost:3006', positionPath: '/v1/capability/liquidity/position/:address' },
    { capability: 'lending', url: process.env.LENDING_API_BASE || 'http://localhost:3007', positionPath: '/v1/capability/lending/position/:address' },
  ];

  const portfolio = new PortfolioService(endpoints);

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'portfolio-service', timestamp: new Date().toISOString() });
  });

  app.get('/v1/portfolio/:address', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : undefined;
    const summary = await portfolio.getPortfolio(req.params.address, chainId);
    res.json(summary);
  });

  app.get('/v1/portfolio/:address/:capability', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : undefined;
    const result = await portfolio.getPositionsByCapability(req.params.address, req.params.capability, chainId);
    if (!result) return res.status(404).json({ error: `Unknown capability: ${req.params.capability}` });
    res.json(result);
  });

  return app;
}
