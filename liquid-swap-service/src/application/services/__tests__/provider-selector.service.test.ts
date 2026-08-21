// ProviderSelectorService Unit Tests
import { ProviderSelectorService } from '../provider-selector.service';
import { RouterDomainService } from '../../../domain/services/router.domain.service';
import { ISwapProvider } from '../../../domain/ports/swap.provider.port';
import { SwapRequest, SwapQuote } from '../../../domain/entities/swap';

// Mock Provider
class MockProvider implements ISwapProvider {
  constructor(public name: string, private shouldSupport: boolean = true) {}

  async supportsRoute(): Promise<boolean> {
    return this.shouldSupport;
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
    return {
      provider: this.name,
      transactions: [],
      estimatedDuration: 30,
    };
  }

  async monitorTransaction(): Promise<any> {
    return 'COMPLETED';
  }
}

describe('ProviderSelectorService', () => {
  let selectorService: ProviderSelectorService;
  let routerService: RouterDomainService;
  let mockProvider1: MockProvider;
  let mockProvider2: MockProvider;

  beforeEach(() => {
    mockProvider1 = new MockProvider('uniswap');
    mockProvider2 = new MockProvider('thirdweb');

    const providerMap = new Map<string, ISwapProvider>();
    providerMap.set(mockProvider1.name, mockProvider1);
    providerMap.set(mockProvider2.name, mockProvider2);

    routerService = new RouterDomainService(providerMap);
    selectorService = new ProviderSelectorService(routerService);
  });

  describe('getQuoteWithBestProvider', () => {
    it('should return quote with provider name', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await selectorService.getQuoteWithBestProvider(request);

      expect(result.provider).toBeDefined();
      expect(result.quote).toBeDefined();
      expect(result.quote.estimatedReceiveAmount).toBe(BigInt(1000000));
    });

    it('should include provider name in response', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await selectorService.getQuoteWithBestProvider(request);

      expect(typeof result.provider).toBe('string');
      expect(['uniswap', 'thirdweb']).toContain(result.provider);
    });

    it('should return valid quote object', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await selectorService.getQuoteWithBestProvider(request);

      expect(result.quote).toHaveProperty('estimatedReceiveAmount');
      expect(result.quote).toHaveProperty('bridgeFee');
      expect(result.quote).toHaveProperty('gasFee');
      expect(result.quote).toHaveProperty('exchangeRate');
      expect(result.quote).toHaveProperty('estimatedDuration');
    });
  });

  describe('prepareSwapWithProvider', () => {
    it('should prepare swap with specified provider', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await selectorService.prepareSwapWithProvider(request, 'uniswap');

      expect(result.provider).toBe('uniswap');
      expect(result.prepared).toBeDefined();
      expect(result.prepared.transactions).toBeDefined();
      expect(Array.isArray(result.prepared.transactions)).toBe(true);
    });

    it('should throw error for non-existent provider', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await expect(
        selectorService.prepareSwapWithProvider(request, 'non-existent')
      ).rejects.toThrow();
    });

    it('should include estimated duration in response', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      const result = await selectorService.prepareSwapWithProvider(request, 'uniswap');

      expect(result.prepared).toBeDefined();
      expect(result.prepared.estimatedDuration).toBeDefined();
      expect(typeof result.prepared.estimatedDuration).toBe('number');
      expect(result.prepared.estimatedDuration).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from router service', async () => {
      // Mock router to throw error
      jest.spyOn(routerService, 'selectBestProvider').mockRejectedValue(
        new Error('No providers available')
      );

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await expect(selectorService.getQuoteWithBestProvider(request)).rejects.toThrow(
        'No providers available'
      );
    });

    it('should handle provider not found error', async () => {
      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await expect(
        selectorService.prepareSwapWithProvider(request, 'invalid-provider')
      ).rejects.toThrow("Provider 'invalid-provider' not available");
    });
  });

  describe('Integration with RouterService', () => {
    it('should delegate provider selection to router', async () => {
      const selectBestProviderSpy = jest.spyOn(routerService, 'selectBestProvider');

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await selectorService.getQuoteWithBestProvider(request);

      expect(selectBestProviderSpy).toHaveBeenCalledWith(request);
    });

    it('should delegate prepare swap to specific provider', async () => {
      const prepareSwapSpy = jest.spyOn(mockProvider1, 'prepareSwap');

      const request = new SwapRequest(
        1,
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        BigInt(1000000),
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890'
      );

      await selectorService.prepareSwapWithProvider(request, 'uniswap');

      expect(prepareSwapSpy).toHaveBeenCalledWith(request);
    });
  });
});
