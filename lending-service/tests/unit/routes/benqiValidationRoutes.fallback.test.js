const express = require('express');
const request = require('supertest');
const { ethers } = require('ethers');

jest.mock('../../../lib/provider', () => ({
  createAvalancheProvider: jest.fn(() => ({ kind: 'provider' })),
}));

jest.mock('../../../middleware/auth', () => ({
  verifySignature: (_req, _res, next) => next(),
  createRateLimiter: () => (_req, _res, next) => next(),
  sanitizeInput: (_req, _res, next) => next(),
  prepareTransactionData: (_req, _res, next) => next(),
}));

jest.mock('../../../services/benqiService', () => jest.fn());
jest.mock('../../../services/validationService', () => jest.fn());

describe('benqiValidationRoutes fallback mode', () => {
  const describeRoutes =
    process.env.CI === 'true' || process.env.ALLOW_SOCKET_TESTS === 'true'
      ? describe
      : describe.skip;

  const qTokenAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  let BenqiService;
  let ValidationService;
  let benqiServiceMock;
  let app;

  function buildApp() {
    const router = require('../../../routes/benqiValidationRoutes');
    const instance = express();
    instance.use(express.json());
    instance.use('/', router);
    return instance;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.VALIDATION_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';

    BenqiService = require('../../../services/benqiService');
    ValidationService = require('../../../services/validationService');

    benqiServiceMock = {
      prepareSupply: jest.fn().mockResolvedValue({
        chainId: 43114,
        to: qTokenAddress,
        value: '1000',
        gas: '300000',
        data: '0xabcdef01',
      }),
      prepareBorrow: jest.fn().mockResolvedValue({
        chainId: 43114,
        to: qTokenAddress,
        value: '0',
        gas: '300000',
        data: '0xabcdef02',
      }),
    };

    BenqiService.mockImplementation(() => benqiServiceMock);
    ValidationService.mockImplementation(() => ({
      preparePayAndValidate: jest.fn(),
    }));

    app = buildApp();
  });

  describeRoutes('socket-dependent checks', () => {
    test('validateAndSupply bypasses validation contract when not configured', async () => {
      const response = await request(app).post('/validateAndSupply').send({
        amount: '1000',
        qTokenAddress,
        address: '0x1111111111111111111111111111111111111111',
        signature: '0xsig',
        message: 'msg',
      });

      expect(response.status).toBe(200);
      expect(response.body?.msg).toBe('success');
      expect(response.body?.data?.validationBypassed).toBe(true);
      expect(response.body?.data?.validation).toBeNull();
      expect(response.body?.data?.supply?.walletType).toBe('smart_wallet');
      expect(benqiServiceMock.prepareSupply).toHaveBeenCalledWith(qTokenAddress, '1000');
    });

    test('validateAndBorrow bypasses validation contract when not configured', async () => {
      const response = await request(app).post('/validateAndBorrow').send({
        amount: '2000',
        qTokenAddress,
        address: '0x1111111111111111111111111111111111111111',
        signature: '0xsig',
        message: 'msg',
      });

      expect(response.status).toBe(200);
      expect(response.body?.msg).toBe('success');
      expect(response.body?.data?.validationBypassed).toBe(true);
      expect(response.body?.data?.validation).toBeNull();
      expect(response.body?.data?.borrow?.walletType).toBe('smart_wallet');
      expect(benqiServiceMock.prepareBorrow).toHaveBeenCalledWith(qTokenAddress, '2000');
    });
  });
});
