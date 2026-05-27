import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('monitoring-service smoke', () => {
  const app = createApp({ services: [] });

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('monitoring-service');
  });

  it('GET /v1/monitoring/health/services returns empty list when no services configured', async () => {
    const res = await request(app).get('/v1/monitoring/health/services');
    expect(res.status).toBe(200);
    expect(res.body.services).toEqual([]);
  });

  it('GET /v1/monitoring/health/providers returns empty list', async () => {
    const res = await request(app).get('/v1/monitoring/health/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([]);
  });
});
