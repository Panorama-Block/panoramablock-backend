import { PanoramaV1Controller } from '../../src/interfaces/http/controllers/PanoramaV1Controller';

function createMocks() {
  const service: any = {
    linkWallet: jest.fn(),
    prepareSwap: jest.fn(),
    submitPreparedSwap: jest.fn(),
    getLiquidStakePosition: jest.fn(),
    prepareLiquidStake: jest.fn(),
    prepareLiquidUnlock: jest.fn(),
    prepareLiquidRedeem: jest.fn(),
    submitPreparedLiquidOperation: jest.fn(),
    failPreparedLiquidOperation: jest.fn(),
    prepareOwnershipChallenge: jest.fn(),
    verifyOwnership: jest.fn(),
  };

  const controller = new PanoramaV1Controller(service);
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();

  return { controller, service, res, next };
}

describe('PanoramaV1Controller wallet endpoints', () => {
  it('requires user identity for wallet ownership challenge', async () => {
    const { controller, res, next } = createMocks();

    await controller.prepareOwnershipChallenge(
      { params: { id: '11111111-1111-4111-8111-111111111111' }, headers: {} } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 401,
      code: 'UNAUTHORIZED',
    }));
  });

  it('rejects invalid wallet id for ownership verification', async () => {
    const { controller, res, next } = createMocks();

    await controller.verifyOwnership(
      {
        user: { id: 'u1' },
        params: { id: 'not-a-uuid' },
        body: { challengeId: '22222222-2222-4222-8222-222222222222', signature: '0xabc' },
        headers: {},
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects invalid challenge id for ownership verification', async () => {
    const { controller, res, next } = createMocks();

    await controller.verifyOwnership(
      {
        user: { id: 'u1' },
        params: { id: '11111111-1111-4111-8111-111111111111' },
        body: { challengeId: 'bad-id', signature: '0xabc' },
        headers: {},
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes TON link payload through to the service', async () => {
    const { controller, service, res, next } = createMocks();
    service.linkWallet.mockResolvedValue({ id: 'w1' });

    await controller.linkWallet(
      {
        user: { id: 'u1' },
        headers: {},
        body: {
          chain: 'ton',
          address: 'EQ-ton-wallet',
          walletType: 'ton',
          provider: 'wdk',
          publicKey: '0x' + '11'.repeat(32),
          metadata: { relinked: true },
        },
      } as any,
      res,
      next
    );

    expect(service.linkWallet).toHaveBeenCalledWith({
      userId: 'u1',
      chain: 'ton',
      address: 'EQ-ton-wallet',
      walletType: 'ton',
      provider: 'wdk',
      publicKey: '0x' + '11'.repeat(32),
      metadata: { relinked: true },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'w1' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls service for a valid ownership challenge request', async () => {
    const { controller, service, res, next } = createMocks();
    service.prepareOwnershipChallenge.mockResolvedValue({ challengeId: 'c1' });

    await controller.prepareOwnershipChallenge(
      {
        user: { id: 'u1' },
        headers: {},
        params: { id: '11111111-1111-4111-8111-111111111111' },
      } as any,
      res,
      next
    );

    expect(service.prepareOwnershipChallenge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'u1');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { challengeId: 'c1' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls service for a valid ownership verification request', async () => {
    const { controller, service, res, next } = createMocks();
    service.verifyOwnership.mockResolvedValue({ ownershipVerified: true });

    await controller.verifyOwnership(
      {
        headers: {},
        user: { id: 'u1' },
        params: { id: '11111111-1111-4111-8111-111111111111' },
        body: {
          challengeId: '22222222-2222-4222-8222-222222222222',
          signature: 'deadbeef',
          publicKey: '0x' + '22'.repeat(32),
        },
      } as any,
      res,
      next
    );

    expect(service.verifyOwnership).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'u1',
      {
        challengeId: '22222222-2222-4222-8222-222222222222',
        signature: 'deadbeef',
        publicKey: '0x' + '22'.repeat(32),
      }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ownershipVerified: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls service for swap prepare requests', async () => {
    const { controller, service, res, next } = createMocks();
    service.prepareSwap.mockResolvedValue({ id: 's1', status: 'prepared' });

    await controller.prepareSwap(
      {
        headers: {},
        user: { id: 'u1' },
        body: {
          walletId: '11111111-1111-4111-8111-111111111111',
          policyId: '22222222-2222-4222-8222-222222222222',
          provider: 'wdk',
          signedIntent: 'signed',
          swap: {
            fromChainId: 8453,
            toChainId: 8453,
            fromToken: '0xfrom',
            toToken: '0xto',
            amountRaw: '100',
            amountDisplay: '100',
          },
        },
      } as any,
      res,
      next
    );

    expect(service.prepareSwap).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('calls service for prepared swap submission', async () => {
    const { controller, service, res, next } = createMocks();
    service.submitPreparedSwap.mockResolvedValue({ id: 's1', status: 'submitted' });

    await controller.submitPreparedSwap(
      {
        headers: {},
        user: { id: 'u1' },
        params: { id: '11111111-1111-4111-8111-111111111111' },
        body: {
          walletId: '22222222-2222-4222-8222-222222222222',
          txHashes: [{ hash: '0xabc', chainId: 8453 }],
        },
      } as any,
      res,
      next
    );

    expect(service.submitPreparedSwap).toHaveBeenCalledWith({
      userId: 'u1',
      swapId: '11111111-1111-4111-8111-111111111111',
      walletId: '22222222-2222-4222-8222-222222222222',
      txHashes: [{ hash: '0xabc', chainId: 8453 }],
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls service for liquid staking prepare requests', async () => {
    const { controller, service, res, next } = createMocks();
    service.prepareLiquidStake.mockResolvedValue({ id: 'liq1', status: 'prepared', action: 'stake' });

    await controller.prepareLiquidStake(
      {
        headers: {},
        user: { id: 'u1' },
        body: {
          walletId: '11111111-1111-4111-8111-111111111111',
          policyId: '22222222-2222-4222-8222-222222222222',
          provider: 'wdk',
          signedIntent: 'signed',
          liquidStake: {
            chainId: 43114,
            token: 'AVAX',
            amountRaw: '100',
            amountDisplay: '100',
          },
        },
      } as any,
      res,
      next
    );

    expect(service.prepareLiquidStake).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects invalid liquid redeem payload', async () => {
    const { controller, res, next } = createMocks();

    await controller.prepareLiquidRedeem(
      {
        headers: {},
        user: { id: 'u1' },
        body: {
          walletId: '11111111-1111-4111-8111-111111111111',
          policyId: '22222222-2222-4222-8222-222222222222',
          provider: 'wdk',
          signedIntent: 'signed',
          liquidStake: {
            chainId: 43114,
            token: 'sAVAX',
            userUnlockIndex: -1,
          },
        },
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
