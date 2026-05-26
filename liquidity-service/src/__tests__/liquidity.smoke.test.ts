/**
 * Smoke test for liquidity-service.
 * Runs against the in-process Express app via supertest — no network, no DB.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app';
import { buildLiquidityContainer } from '../infrastructure/di/container';

describe('liquidity-service smoke', () => {
  const app = createApp({ liquidityContainer: buildLiquidityContainer({ providers: [] }) });

  it('GET /health returns 200 with service metadata', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      service: 'liquidity-service',
      version: '0.1.0',
      providers: 0,
    });
  });

  it('GET / returns the endpoint catalogue', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('PanoramaBlock Liquidity Service');
    expect(res.body.endpoints).toHaveProperty('/v1/capability/liquidity/_discovery');
  });

  it('GET /v1/capability/liquidity/_discovery returns availability map (empty registry)', async () => {
    const res = await request(app).get('/v1/capability/liquidity/_discovery');
    expect(res.status).toBe(200);
    // Discovery handler always returns CapabilitySuccessResponse<AvailabilityMap>. The
    // AvailabilityMap lives in `body.data`. Empty registry → `data.capabilities` is empty.
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('capabilities');
    expect(res.body.data).toHaveProperty('generatedAt');
    expect(res.body.data).toHaveProperty('cacheTtlSeconds');
  });

  it('GET /v1/capability/liquidity/pools rejects when chainId is missing', async () => {
    const res = await request(app).get('/v1/capability/liquidity/pools');
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.error.category).toBe('VALIDATION');
  });

  it('GET /v1/capability/liquidity/pools returns UNSUPPORTED_ROUTE when no providers registered', async () => {
    const res = await request(app).get('/v1/capability/liquidity/pools').query({ chainId: '8453' });
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.error.category).toBe('UNSUPPORTED_ROUTE');
  });

  it('POST /v1/capability/liquidity/prepare-add rejects malformed body with 400', async () => {
    const res = await request(app)
      .post('/v1/capability/liquidity/prepare-add')
      .send({ chainId: 8453 }); // missing userAddress, poolId, amounts
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.error.category).toBe('VALIDATION');
  });

  it('POST /v1/capability/liquidity/prepare-add returns UNSUPPORTED_ROUTE for valid body when no provider', async () => {
    const res = await request(app)
      .post('/v1/capability/liquidity/prepare-add')
      .send({
        userAddress: '0x1234567890123456789012345678901234567890',
        chainId: 8453,
        poolId: 'aerodrome:weth-usdc',
        amounts: ['1000000000000000000', '2000000000'],
      });
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.error.category).toBe('UNSUPPORTED_ROUTE');
  });
});
