// RouterDomainService Unit Tests
import { ProviderRegistry, type ProviderMetadata } from '@panorama/capability';
import { RouterDomainService } from '../router.domain.service';
import { ISwapProvider } from '../../ports/swap.provider.port';
import { SwapRequest, SwapQuote } from '../../entities/swap';

// Mock Provider
class MockUniswapProvider implements ISwapProvider {
  name = 'uniswap';
  readonly metadata: ProviderMetadata = {
    name: 'uniswap',
    capability: 'swap',
    supportedChains: [1],
    version: '0.0.1',
    enabled: true,
  };

  async supportsRoute(params: any): Promise<boolean> {
    return params.fromChainId === params.toChainId && params.fromChainId === 1;
  }

  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    return new SwapQuote(
      BigInt(1000000),
      BigInt(0),
      BigInt(100000),
      1.0,
      30
    );
  }

  async prepareSwap(): Promise<any> {
    return { provider: this.name, transactions: [] };
  }

  async monitorTransaction(): Promise<any> {
    return 'COMPLETED';
  }
}

class MockThirdwebProvider implements ISwapProvider {
  name = 'thirdweb';
  readonly metadata: ProviderMetadata = {
    name: 'thirdweb',
    capability: 'swap',
    supportedChains: [1, 137, 8453],
    version: '0.0.1',
    enabled: true,
  };

  async supportsRoute(): Promise<boolean> {
    return true; // Always supports
  }

  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    return new SwapQuote(
      BigInt(900000),
      BigInt(10000),
      BigInt(50000),
      0.9,
      120
    );
  }

  async prepareSwap(): Promise<any> {
    return { provider: this.name, transactions: [] };
  }

  async monitorTransaction(): Promise<any> {
    return 'PENDING';
  }
}

describe('RouterDomainService', () => {
  let routerService: RouterDomainService;
  let mockUniswap: MockUniswapProvider;
  let mockThirdweb: MockThirdwebProvider;
  let registry: ProviderRegistry<ISwapProvider>;

  beforeEach(() => {
    mockUniswap = new MockUniswapProvider();
    mockThirdweb = new MockThirdwebProvider();
    registry = new ProviderRegistry<ISwapProvider>();
    registry.register(mockUniswap);
    registry.register(mockThirdweb);
    routerService = new RouterDomainService(registry);
  });

  describe('Initialization', () => {
    it('should initialize with correct number of providers', () => {
      expect(registry.size()).toBe(2);
    });

    it('should have uniswap and thirdweb providers', () => {
      expect(registry.getByName('uniswap')).toBeDefined();
      expect(registry.getByName('thirdweb')).toBeDefined();
    });
  });

  describe('Same-Chain Routing', () => {
    it('should select Uniswap for same-chain swaps when available', async () => {
      const request = new SwapRequest(
        1, // Ethereum
        1, // Ethereum
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await routerService.selectBestProvider(request);

      expect(result.provider.name).toBe('uniswap');
      expect(result.quote).toBeDefined();
      expect(result.quote.estimatedReceiveAmount).toBe(BigInt(1000000));
    });

    it('should fallback to Thirdweb if Uniswap fails', async () => {
      // Mock Uniswap to throw error
      jest.spyOn(mockUniswap, 'getQuote').mockRejectedValue(new Error('Uniswap API error'));

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await routerService.selectBestProvider(request);

      expect(result.provider.name).toBe('thirdweb');
      expect(result.quote).toBeDefined();
    });
  });

  describe('Cross-Chain Routing', () => {
    it('should select Thirdweb for cross-chain swaps', async () => {
      const request = new SwapRequest(
        1,   // Ethereum
        137, // Polygon
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await routerService.selectBestProvider(request);

      expect(result.provider.name).toBe('thirdweb');
      expect(result.quote.bridgeFee).toBeGreaterThanOrEqual(BigInt(0));
    });

    it('should not select Uniswap for cross-chain swaps', async () => {
      const request = new SwapRequest(
        1,
        137,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await routerService.selectBestProvider(request);

      expect(result.provider.name).not.toBe('uniswap');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when no providers support the route', async () => {
      // Mock both providers to not support the route
      jest.spyOn(mockUniswap, 'supportsRoute').mockResolvedValue(false);
      jest.spyOn(mockThirdweb, 'supportsRoute').mockResolvedValue(false);

      const request = new SwapRequest(
        999999,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await expect(routerService.selectBestProvider(request)).rejects.toThrow();
    });

    it('should throw error when all providers fail to get quote', async () => {
      // Mock both providers to throw errors
      jest.spyOn(mockUniswap, 'getQuote').mockRejectedValue(new Error('Uniswap failed'));
      jest.spyOn(mockThirdweb, 'getQuote').mockRejectedValue(new Error('Thirdweb failed'));

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await expect(routerService.selectBestProvider(request)).rejects.toThrow();
    });
  });

  describe('Provider Priority', () => {
    it('should prioritize Uniswap for same-chain swaps', async () => {
      const getQuoteSpy = jest.spyOn(mockUniswap, 'getQuote');

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await routerService.selectBestProvider(request);

      expect(getQuoteSpy).toHaveBeenCalled();
    });

    it('should prioritize Thirdweb for cross-chain swaps', async () => {
      const getQuoteSpy = jest.spyOn(mockThirdweb, 'getQuote');

      const request = new SwapRequest(
        1,
        137,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await routerService.selectBestProvider(request);

      expect(getQuoteSpy).toHaveBeenCalled();
    });
  });
});
