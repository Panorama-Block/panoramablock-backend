import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('portfolio-service smoke', () => {
  const app = createApp({ endpoints: [] });

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('portfolio-service');
  });

  it('GET /v1/portfolio/:address returns empty summary when no endpoints', async () => {
    const res = await request(app).get('/v1/portfolio/0x1234567890123456789012345678901234567890');
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual([]);
    expect(res.body.totalValueUsd).toBe(0);
    expect(res.body.userAddress).toBe('0x1234567890123456789012345678901234567890');
  });

  it('GET /v1/portfolio/:address/:capability returns 404 for unknown capability', async () => {
    const res = await request(app).get('/v1/portfolio/0x1234567890123456789012345678901234567890/unknown');
    expect(res.status).toBe(404);
  });
});
