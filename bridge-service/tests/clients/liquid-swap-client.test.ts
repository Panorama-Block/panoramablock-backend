import axios from 'axios';
import { LiquidSwapClient } from '../../src/infrastructure/clients/LiquidSwapClient';

jest.mock('axios');

describe('LiquidSwapClient', () => {
  const post = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    (axios.create as jest.Mock).mockReturnValue({ post });
  });

  it('normalizes wrapped prepared responses into bridge execution shape', async () => {
    const expiresAt = '2026-03-20T12:00:00.000Z';
    post.mockResolvedValue({
      data: {
        success: true,
        provider: 'thirdweb',
        prepared: {
          provider: 'thirdweb',
          expiresAt,
          transactions: [
            {
              chainId: 8453,
              to: '0x1111111111111111111111111111111111111111',
              data: '0xabc',
              value: '0',
            },
            {
              chainId: 8453,
              to: '0x2222222222222222222222222222222222222222',
              data: '0xdef',
              value: '0',
            },
          ],
          metadata: {
            providerDebug: {
              quoteId: 'quote-1',
              approvalSkipped: true,
            },
            quote: {
              amount: '2126714',
              aggregatedOutputs: [{ minAmount: '2000000' }],
            },
          },
        },
      },
    });

    const client = new LiquidSwapClient('http://liquid-swap');
    const response = await client.prepareSwap({
      fromChainId: 8453,
      toChainId: 8453,
      fromToken: '0x4200000000000000000000000000000000000006',
      toToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '1000000000000000',
      sender: '0x270b68B3B1b783459C48813C555820c9Bd32D87b',
    });

    expect(response.provider).toBe('thirdweb');
    expect(response.txData).toEqual({});
    expect(response.route).toEqual(
      expect.objectContaining({
        transactions: [
          expect.objectContaining({
            chainId: 8453,
            to: '0x1111111111111111111111111111111111111111',
            feeMode: 'advisory',
          }),
          expect.objectContaining({
            chainId: 8453,
            to: '0x2222222222222222222222222222222222222222',
            feeMode: 'advisory',
          }),
        ],
      })
    );
    expect(response.estimatedOutput).toBe('2126714');
    expect(response.minOutput).toBe('2000000');
    expect(response.expiresAt).toBe(expiresAt);
    expect(response.stale).toBe(false);
    expect(response.providerDebug).toEqual({
      quoteId: 'quote-1',
      approvalSkipped: true,
    });
  });
});
