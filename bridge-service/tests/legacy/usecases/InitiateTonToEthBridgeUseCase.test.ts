import { PrismaClient } from '@prisma/client';
import { InitiateTonToEthBridgeUseCase } from '../../src/application/usecases/InitiateTonToEthBridgeUseCase';
import { ITonBridgeService } from '../../src/domain/interfaces/ITonBridgeService';
import { TacEventService } from '../../src/application/services/TacEventService';

describe('InitiateTonToEthBridgeUseCase', () => {
  const prismaMock = {
    tonWallet: { findUnique: jest.fn() },
    evmWallet: { findUnique: jest.fn(), upsert: jest.fn() },
    tonBridgeRequest: { upsert: jest.fn() }
  } as unknown as PrismaClient;

  const tonBridgeServiceMock: ITonBridgeService = {
    bridgeTonToEthereum: jest.fn().mockResolvedValue({
      bridgeId: 'bridge123',
      metadata: { transactionPayload: { to: 'addr', value: '1', body: 'boc' } }
    } as any),
    getBridgeStatus: jest.fn(),
    getBridgeQuote: jest.fn()
  };

  const eventServiceMock = {
    recordEvent: jest.fn()
  } as unknown as TacEventService;

  const useCase = new InitiateTonToEthBridgeUseCase(
    prismaMock,
    tonBridgeServiceMock,
    eventServiceMock
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.tonWallet.findUnique as any).mockResolvedValue({ userId: 'user1', tonAddressRaw: 'ton' });
    (prismaMock.evmWallet.findUnique as any).mockResolvedValue({ address: '0xabc', userId: 'user1' });
    (prismaMock.tonBridgeRequest.upsert as any).mockResolvedValue({});
  });

  it('initiates bridge when wallets are valid', async () => {
    const result = await useCase.execute('user1', {
      tonAddress: 'ton',
      token: 'USDT',
      amount: '10',
      destinationChainId: 1
    });

    expect(prismaMock.tonWallet.findUnique).toHaveBeenCalled();
    expect(prismaMock.evmWallet.findUnique).toHaveBeenCalled();
    expect(tonBridgeServiceMock.bridgeTonToEthereum).toHaveBeenCalledWith(
      expect.objectContaining({
        tonWallet: 'ton',
        destinationAddress: '0xabc',
        token: 'USDT',
        amount: '10'
      })
    );
    expect(prismaMock.tonBridgeRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bridgeId: 'bridge123' }
      })
    );
    expect(eventServiceMock.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'ton_to_eth_bridge_initiated'
    }));
    expect(result.bridge.bridgeId).toBe('bridge123');
  });

  it('throws if ton wallet not owned by user', async () => {
    (prismaMock.tonWallet.findUnique as any).mockResolvedValue(null);
    await expect(useCase.execute('user1', {
      tonAddress: 'ton',
      token: 'USDT',
      amount: '10'
    })).rejects.toThrow(/not linked/);
  });
});
