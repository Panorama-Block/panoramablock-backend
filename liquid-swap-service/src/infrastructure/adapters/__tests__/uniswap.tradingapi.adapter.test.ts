import axios from 'axios';
import { UniswapTradingApiAdapter } from '../uniswap.tradingapi.adapter';
import { SwapRequest } from '../../../domain/entities/swap';

jest.mock('axios');

describe('UniswapTradingApiAdapter', () => {
  const post = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.UNISWAP_TRADING_API_SLIPPAGE;
    (axios.create as jest.Mock).mockReturnValue({
      post,
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    });
  });

  it('omits auto slippageTolerance from quote requests', async () => {
    post.mockResolvedValue({
      data: {
        quote: {
          amount: '2126714',
        },
      },
    });

    const adapter = new UniswapTradingApiAdapter({
      apiKey: 'test-key',
      apiUrl: 'https://trade-api.gateway.uniswap.org/v1',
    });

    const request = new SwapRequest(
      8453,
      8453,
      '0x4200000000000000000000000000000000000006',
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      BigInt('1000000000000000'),
      '0x270b68B3B1b783459C48813C555820c9Bd32D87b',
      '0x270b68B3B1b783459C48813C555820c9Bd32D87b'
    );

    await adapter.getQuote(request);

    expect(post).toHaveBeenCalledWith(
      '/quote',
      expect.not.objectContaining({
        slippageTolerance: expect.anything(),
      })
    );
  });

  it('omits auto slippageTolerance from prepareSwap quote requests', async () => {
    post
      .mockResolvedValueOnce({
        data: {
          quote: {
            amount: '989520000000000',
            quoteId: 'quote-123',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          swap: {
            to: '0x1111111111111111111111111111111111111111',
            data: '0x1234',
            value: '1000000000000000',
            chainId: 8453,
            gasLimit: '210000',
          },
        },
      });

    const adapter = new UniswapTradingApiAdapter({
      apiKey: 'test-key',
      apiUrl: 'https://trade-api.gateway.uniswap.org/v1',
    });

    const request = new SwapRequest(
      8453,
      8453,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x4200000000000000000000000000000000000006',
      BigInt('1000000000000000'),
      '0x270b68B3B1b783459C48813C555820c9Bd32D87b',
      '0x270b68B3B1b783459C48813C555820c9Bd32D87b'
    );

    await adapter.prepareSwap(request);

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/quote',
      expect.not.objectContaining({
        slippageTolerance: expect.anything(),
      })
    );
  });
});
