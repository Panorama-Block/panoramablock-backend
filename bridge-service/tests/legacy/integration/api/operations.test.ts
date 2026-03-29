// Integration Tests for TAC Operations API
import request from 'supertest';
import { Express } from 'express';
import { DIContainer, createDIContainer } from '../../../src/infrastructure/di/container';
import { createHttpServer } from '../../../src/infrastructure/http/server';
import express from 'express';

describe('TAC Operations API Integration', () => {
  let app: Express;
  let container: DIContainer;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create test container with test database
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5433/tac_test';
    process.env.TAC_SDK_ENDPOINT = 'http://localhost:8080';
    process.env.TAC_API_KEY = 'test_api_key_123';
    process.env.TAC_WEBHOOK_SECRET = 'test_webhook_secret';
    process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters';

    container = await createDIContainer();

    // Setup Express app
    app = express();
    await createHttpServer(app, container);

    // Setup test user and auth token
    testUserId = 'test_user_123';
    authToken = generateTestJWT(testUserId);

    // Initialize test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    await container.database.$disconnect();
  });

  beforeEach(async () => {
    // Clean test data before each test
    await cleanTestData();
  });

  describe('POST /api/tac/operations', () => {
    const validOperationRequest = {
      operationType: 'cross_chain_swap',
      sourceChain: 'ton',
      targetChain: 'ethereum',
      inputToken: 'TON',
      inputAmount: 100,
      outputToken: 'USDC',
      protocol: 'uniswap',
      slippage: 0.5
    };

    it('should create a new cross-chain swap operation', async () => {
      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validOperationRequest)
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Operation created and execution started'
      });

      expect(response.body.data).toMatchObject({
        operationId: expect.any(String),
        status: 'initiated',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100,
        createdAt: expect.any(String)
      });

      expect(response.body.data.steps).toBeInstanceOf(Array);
      expect(response.body.data.steps.length).toBeGreaterThan(0);
    });

    it('should create a cross-chain lending operation', async () => {
      const lendingRequest = {
        operationType: 'cross_chain_lending',
        sourceChain: 'ton',
        targetChain: 'avalanche',
        inputToken: 'USDC',
        inputAmount: 1000,
        protocol: 'benqi',
        protocolAction: 'supply'
      };

      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lendingRequest)
        .expect(201);

      expect(response.body.data.operationType).toBe('cross_chain_lending');
      expect(response.body.data.protocol).toBe('benqi');
    });

    it('should create a cross-chain staking operation', async () => {
      const stakingRequest = {
        operationType: 'cross_chain_staking',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'ETH',
        inputAmount: 1,
        protocol: 'lido'
      };

      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(stakingRequest)
        .expect(201);

      expect(response.body.data.operationType).toBe('cross_chain_staking');
      expect(response.body.data.protocol).toBe('lido');
    });

    it('should validate required fields', async () => {
      const invalidRequest = {
        operationType: 'cross_chain_swap',
        sourceChain: 'ton'
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('validation');
    });

    it('should reject invalid operation type', async () => {
      const invalidRequest = {
        ...validOperationRequest,
        operationType: 'invalid_operation'
      };

      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject negative amounts', async () => {
      const invalidRequest = {
        ...validOperationRequest,
        inputAmount: -100
      };

      const response = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/tac/operations')
        .send(validOperationRequest)
        .expect(401);
    });

    it('should reject invalid JWT token', async () => {
      await request(app)
        .post('/api/tac/operations')
        .set('Authorization', 'Bearer invalid_token')
        .send(validOperationRequest)
        .expect(401);
    });
  });

  describe('GET /api/tac/operations', () => {
    beforeEach(async () => {
      // Create test operations
      await createTestOperation('completed', 'cross_chain_swap');
      await createTestOperation('failed', 'cross_chain_lending');
      await createTestOperation('in_progress', 'cross_chain_staking');
    });

    it('should get user operations', async () => {
      const response = await request(app)
        .get('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(3);
      expect(response.body.pagination).toMatchObject({
        limit: 50,
        offset: 0,
        hasMore: false
      });
    });

    it('should filter operations by status', async () => {
      const response = await request(app)
        .get('/api/tac/operations?status=completed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].status).toBe('completed');
    });

    it('should filter operations by type', async () => {
      const response = await request(app)
        .get('/api/tac/operations?operationType=cross_chain_swap')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].operationType).toBe('cross_chain_swap');
    });

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/tac/operations?limit=2&offset=0')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(2);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.hasMore).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/tac/operations')
        .expect(401);
    });
  });

  describe('GET /api/tac/operations/:operationId', () => {
    let testOperationId: string;

    beforeEach(async () => {
      testOperationId = await createTestOperation('in_progress', 'cross_chain_swap');
    });

    it('should get operation details', async () => {
      const response = await request(app)
        .get(`/api/tac/operations/${testOperationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.operationId).toBe(testOperationId);
      expect(response.body.data).toHaveProperty('steps');
      expect(response.body.data).toHaveProperty('progress');
      expect(response.body.data).toHaveProperty('currentStep');
      expect(response.body.data).toHaveProperty('totalSteps');
    });

    it('should return 404 for non-existent operation', async () => {
      const response = await request(app)
        .get('/api/tac/operations/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('OPERATION_NOT_FOUND');
    });

    it('should deny access to other users operations', async () => {
      const otherUserToken = generateTestJWT('other_user');

      const response = await request(app)
        .get(`/api/tac/operations/${testOperationId}`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('OPERATION_ACCESS_DENIED');
    });
  });

  describe('POST /api/tac/operations/:operationId/cancel', () => {
    let testOperationId: string;

    beforeEach(async () => {
      testOperationId = await createTestOperation('in_progress', 'cross_chain_swap');
    });

    it('should cancel operation', async () => {
      const response = await request(app)
        .post(`/api/tac/operations/${testOperationId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('cancelled');
    });

    it('should not cancel completed operation', async () => {
      const completedOperationId = await createTestOperation('completed', 'cross_chain_swap');

      await request(app)
        .post(`/api/tac/operations/${completedOperationId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('POST /api/tac/operations/:operationId/retry', () => {
    let failedOperationId: string;

    beforeEach(async () => {
      failedOperationId = await createTestOperation('failed', 'cross_chain_swap');
    });

    it('should retry failed operation', async () => {
      const response = await request(app)
        .post(`/api/tac/operations/${failedOperationId}/retry`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('retry initiated');
    });

    it('should not retry completed operation', async () => {
      const completedOperationId = await createTestOperation('completed', 'cross_chain_swap');

      await request(app)
        .post(`/api/tac/operations/${completedOperationId}/retry`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/tac/operations/:operationId/status', () => {
    let testOperationId: string;

    beforeEach(async () => {
      testOperationId = await createTestOperation('in_progress', 'cross_chain_swap');
    });

    it('should get operation status', async () => {
      const response = await request(app)
        .get(`/api/tac/operations/${testOperationId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        status: expect.any(String),
        currentStep: expect.any(Number),
        totalSteps: expect.any(Number),
        progress: expect.any(Number)
      });
    });
  });

  // Helper functions
  function generateTestJWT(userId: string): string {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { sub: userId, role: 'user' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
  }

  async function setupTestDatabase(): Promise<void> {
    // Run Prisma migrations for test database
    await container.database.$executeRaw`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  }

  async function cleanTestData(): Promise<void> {
    // Clean all test data
    await container.database.tacStep.deleteMany({ where: {} });
    await container.database.tacOperation.deleteMany({ where: {} });
  }

  async function createTestOperation(status: string, operationType: string): Promise<string> {
    const operation = await container.database.tacOperation.create({
      data: {
        id: require('uuid').v4(),
        userId: testUserId,
        operationType,
        status,
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100,
        currentStep: 0,
        retryCount: 0,
        canRetry: status === 'failed',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    return operation.id;
  }
});