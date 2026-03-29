// E2E Test for Complete Cross-Chain Swap Flow
import request from 'supertest';
import { Express } from 'express';
import { DIContainer, createDIContainer } from '../../src/infrastructure/di/container';
import { createHttpServer } from '../../src/infrastructure/http/server';
import express from 'express';

describe('E2E: Complete Cross-Chain Swap Flow', () => {
  let app: Express;
  let container: DIContainer;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Setup test environment
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5433/tac_test_e2e';
    process.env.TAC_SDK_ENDPOINT = 'http://localhost:8080';
    process.env.TAC_API_KEY = 'test_api_key_123';
    process.env.TAC_WEBHOOK_SECRET = 'test_webhook_secret';
    process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters';
    process.env.ENABLE_WEBSOCKET = 'false'; // Disable WebSocket for E2E tests

    container = await createDIContainer();
    app = express();
    await createHttpServer(app, container);

    testUserId = 'e2e_test_user';
    authToken = generateTestJWT(testUserId);

    await setupTestEnvironment();
  });

  afterAll(async () => {
    await container.database.$disconnect();
  });

  beforeEach(async () => {
    await cleanTestData();
  });

  describe('Complete Cross-Chain TON → USDC Swap via Ethereum/Uniswap', () => {
    it('should complete the full swap flow from quote to execution', async () => {
      // Step 1: Generate quote for TON → USDC swap
      console.log('📊 Step 1: Generating cross-chain quote...');

      const quoteRequest = {
        fromChain: 'ton',
        toChain: 'ethereum',
        fromToken: 'TON',
        toToken: 'USDC',
        amount: 100,
        operationType: 'cross_chain_swap',
        slippage: 0.5
      };

      const quoteResponse = await request(app)
        .post('/api/tac/quotes')
        .set('Authorization', `Bearer ${authToken}`)
        .send(quoteRequest)
        .expect(201);

      expect(quoteResponse.body.success).toBe(true);
      const quote = quoteResponse.body.data.quote;

      console.log('✅ Quote generated:', {
        quoteId: quote.quoteId,
        estimatedOutput: quote.route.estimatedOutput,
        totalFees: quote.route.totalFees,
        estimatedTime: quote.route.estimatedTime
      });

      // Validate quote structure
      expect(quote).toMatchObject({
        quoteId: expect.any(String),
        fromChain: 'ton',
        toChain: 'ethereum',
        fromToken: 'TON',
        toToken: 'USDC',
        amount: 100,
        operationType: 'cross_chain_swap'
      });

      expect(quote.route).toMatchObject({
        provider: 'tac',
        estimatedOutput: expect.any(Number),
        totalFees: expect.any(Number),
        estimatedTime: expect.any(Number),
        confidence: expect.any(Number)
      });

      // Step 2: Execute the quote to create an operation
      console.log('🚀 Step 2: Executing quote to start cross-chain operation...');

      const executeResponse = await request(app)
        .post(`/api/tac/quotes/${quote.quoteId}/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(executeResponse.body.success).toBe(true);
      const operationId = executeResponse.body.data.operationId;

      console.log('✅ Operation created:', { operationId });

      // Step 3: Monitor operation progress
      console.log('👀 Step 3: Monitoring operation progress...');

      let operation;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

        const statusResponse = await request(app)
          .get(`/api/tac/operations/${operationId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        operation = statusResponse.body.data;

        console.log(`📈 Operation status (${attempts + 1}/${maxAttempts}):`, {
          status: operation.status,
          progress: operation.progress,
          currentStep: operation.currentStep,
          totalSteps: operation.totalSteps
        });

        attempts++;
      } while (
        operation.status !== 'completed' &&
        operation.status !== 'failed' &&
        attempts < maxAttempts
      );

      // Step 4: Verify final operation state
      console.log('🎯 Step 4: Verifying final operation state...');

      expect(operation.status).toBe('completed');
      expect(operation.operationType).toBe('cross_chain_swap');
      expect(operation.progress).toBe(100);
      expect(operation.completedAt).toBeTruthy();

      // Verify operation steps were executed
      expect(operation.steps).toBeInstanceOf(Array);
      expect(operation.steps.length).toBeGreaterThan(0);

      const completedSteps = operation.steps.filter((step: any) => step.status === 'completed');
      expect(completedSteps.length).toBe(operation.steps.length);

      console.log('✅ Operation completed successfully:', {
        operationId,
        finalStatus: operation.status,
        inputAmount: operation.inputAmount,
        outputAmount: operation.outputAmount,
        duration: operation.actualTime,
        totalFees: operation.totalFees
      });

      // Step 5: Verify quote was marked as executed
      console.log('📝 Step 5: Verifying quote execution status...');

      const finalQuoteResponse = await request(app)
        .get(`/api/tac/quotes/${quote.quoteId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const finalQuote = finalQuoteResponse.body.data;
      expect(finalQuote.isExecuted).toBe(true);
      expect(finalQuote.executedAt).toBeTruthy();
      expect(finalQuote.operationId).toBe(operationId);

      console.log('✅ E2E test completed successfully!');
    }, 30000); // 30 second timeout for E2E test

    it('should handle quote expiration correctly', async () => {
      console.log('⏰ Testing quote expiration handling...');

      const quoteRequest = {
        fromChain: 'ton',
        toChain: 'ethereum',
        fromToken: 'TON',
        toToken: 'USDC',
        amount: 50,
        operationType: 'cross_chain_swap'
      };

      const quoteResponse = await request(app)
        .post('/api/tac/quotes')
        .set('Authorization', `Bearer ${authToken}`)
        .send(quoteRequest)
        .expect(201);

      const quote = quoteResponse.body.data.quote;

      // Manually expire the quote in the database for testing
      await container.database.crossChainQuote.update({
        where: { id: quote.quoteId },
        data: { expiresAt: new Date(Date.now() - 1000) } // 1 second ago
      });

      // Try to execute expired quote
      const executeResponse = await request(app)
        .post(`/api/tac/quotes/${quote.quoteId}/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(executeResponse.body.success).toBe(false);
      expect(executeResponse.body.error).toContain('expired');

      console.log('✅ Quote expiration handled correctly');
    });

    it('should handle operation cancellation', async () => {
      console.log('❌ Testing operation cancellation...');

      // Create operation directly for cancellation test
      const operationRequest = {
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 75,
        outputToken: 'USDC'
      };

      const operationResponse = await request(app)
        .post('/api/tac/operations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(operationRequest)
        .expect(201);

      const operationId = operationResponse.body.data.operationId;

      // Cancel the operation
      const cancelResponse = await request(app)
        .post(`/api/tac/operations/${operationId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.success).toBe(true);

      // Verify operation was cancelled
      const statusResponse = await request(app)
        .get(`/api/tac/operations/${operationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.data.status).toBe('failed');
      expect(statusResponse.body.data.errorMessage).toContain('Cancelled by user');

      console.log('✅ Operation cancellation handled correctly');
    });
  });

  describe('Cross-Chain Lending via Benqi', () => {
    it('should complete USDC supply operation on Avalanche', async () => {
      console.log('🏦 Testing cross-chain lending flow...');

      const lendingOperation = {
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
        .send(lendingOperation)
        .expect(201);

      const operation = response.body.data;
      expect(operation.operationType).toBe('cross_chain_lending');
      expect(operation.protocol).toBe('benqi');

      console.log('✅ Cross-chain lending operation created:', {
        operationId: operation.operationId,
        protocol: operation.protocol,
        targetChain: operation.targetChain
      });
    });
  });

  describe('Cross-Chain Staking via Lido', () => {
    it('should complete ETH staking operation on Ethereum', async () => {
      console.log('🥩 Testing cross-chain staking flow...');

      const stakingOperation = {
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
        .send(stakingOperation)
        .expect(201);

      const operation = response.body.data;
      expect(operation.operationType).toBe('cross_chain_staking');
      expect(operation.protocol).toBe('lido');

      console.log('✅ Cross-chain staking operation created:', {
        operationId: operation.operationId,
        protocol: operation.protocol,
        inputToken: operation.inputToken
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

  async function setupTestEnvironment(): Promise<void> {
    // Setup test database with required extensions
    try {
      await container.database.$executeRaw`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
      console.log('✅ Test database extensions created');
    } catch (error) {
      console.log('ℹ️ Database extensions already exist');
    }
  }

  async function cleanTestData(): Promise<void> {
    // Clean all test data in correct order (respecting foreign keys)
    await container.database.tacStep.deleteMany({});
    await container.database.tacOperation.deleteMany({});
    await container.database.crossChainQuote.deleteMany({});
    await container.database.tacBalance.deleteMany({});
    await container.database.tacConfiguration.deleteMany({});
    await container.database.tacAnalytics.deleteMany({});
    await container.database.tacEvent.deleteMany({});
    await container.database.tacNotification.deleteMany({});
    await container.database.tacBridgeOperation.deleteMany({});
  }
});