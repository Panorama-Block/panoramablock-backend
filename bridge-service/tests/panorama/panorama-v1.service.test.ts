import { PanoramaV1Service } from '../../src/application/services/PanoramaV1Service';
import { WalletBalanceReader } from '../../src/application/services/WalletBalanceReader';
import { Wallet } from 'ethers';
import { generateKeyPairSync, sign } from 'crypto';
import { createBridgeRuntimeConfig } from '../../src/config/runtime';

function createService() {
  const dbGateway: any = {
    getTenantId: () => 'tenant-test',
    createLifecycleEvent: jest.fn().mockResolvedValue(undefined),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([]),
    createWallet: jest.fn(),
    getWallet: jest.fn(),
    createPolicy: jest.fn(),
    getPolicy: jest.fn(),
    updatePolicy: jest.fn(),
    createIntentTransaction: jest.fn(),
    updateIntentTransaction: jest.fn(),
    getIntentTransaction: jest.fn(),
    getIntentByIdempotencyKey: jest.fn(),
    createWebhookSubscription: jest.fn(),
    createOwnershipChallenge: jest.fn(),
    getOwnershipChallenge: jest.fn(),
    updateOwnershipChallenge: jest.fn(),
    updateWallet: jest.fn(),
    upsertUser: jest.fn(),
  };

  const swapClient: any = {
    prepareSwap: jest.fn().mockResolvedValue({ txData: { to: '0x1' }, route: {}, estimatedOutput: '100' }),
  };
  const lidoClient: any = {
    stake: jest.fn().mockResolvedValue({ txHash: '0xstake' }),
  };
  const lendingClient: any = {
    getMarkets: jest.fn().mockResolvedValue({ markets: [] }),
    act: jest.fn().mockResolvedValue({ txHash: '0xlend' }),
  };
  const liquidStakingClient: any = {
    getPosition: jest.fn().mockResolvedValue({
      userAddress: '0xwallet',
      sAvaxBalance: '100',
      avaxEquivalent: '100',
      exchangeRate: '1',
      pendingUnlocks: [],
    }),
    prepareStake: jest.fn().mockResolvedValue({ bundle: { steps: [{ to: '0x1', data: '0x', value: '100', chainId: 43114 }] }, metadata: { protocol: 'savax' } }),
    prepareRequestUnlock: jest.fn().mockResolvedValue({ bundle: { steps: [{ to: '0x2', data: '0x', value: '0', chainId: 43114 }] }, metadata: { protocol: 'savax' } }),
    prepareRedeem: jest.fn().mockResolvedValue({ bundle: { steps: [{ to: '0x3', data: '0x', value: '0', chainId: 43114 }] }, metadata: { protocol: 'savax' } }),
  };

  const adapter: any = {
    provider: 'wdk',
    createWallet: jest.fn().mockResolvedValue({ providerWalletId: 'wallet-provider-id', address: '0xwallet' }),
    linkWallet: jest.fn().mockResolvedValue({ providerWalletId: 'wallet-provider-id', address: '0xwallet', metadata: { mode: 'client-managed' } }),
    registerSession: jest.fn().mockResolvedValue({
      providerSessionId: 'sess-1',
      capabilities: ['sign_intent', 'execute_swap'],
      metadata: { wdk: { session: { sessionId: 'sess-1', capabilities: ['sign_intent', 'execute_swap'] } } },
    }),
    prepareSignature: jest.fn(),
    signIntent: jest.fn(),
    getExecutionStrategy: jest.fn().mockReturnValue('delegated'),
    assertExecutionAllowed: jest.fn().mockResolvedValue(undefined),
    executePlan: jest.fn().mockResolvedValue({ status: 'submitted', txHash: '0xabc' }),
    getExecutionContext: jest.fn(),
  };
  const walletBalanceReader: any = {
    readBalances: jest.fn(),
  };

  const service = new PanoramaV1Service(dbGateway, swapClient, lidoClient, lendingClient, liquidStakingClient, {
    thirdweb: adapter,
    wdk: adapter,
  } as any, 'wdk', walletBalanceReader as WalletBalanceReader);

  return { service, dbGateway, swapClient, lidoClient, lendingClient, liquidStakingClient, adapter, walletBalanceReader };
}

describe('PanoramaV1Service policy validation', () => {
  it('creates an encrypted wallet export without persisting mnemonic material', async () => {
    const { service, dbGateway } = createService();
    dbGateway.createWallet.mockImplementation(async (payload: any) => ({
      id: payload.walletId,
      userId: payload.userId,
      chain: payload.chain,
      address: payload.address,
      walletType: payload.walletType,
      metadata: payload.metadata,
    }));

    const result = await service.createWalletExport({
      userId: 'u1',
      chain: 'base',
      chainScope: 'evm',
      exportPassword: 'password-123',
      name: 'user export wallet',
    });

    expect((result as any).returnedOnce).toBe(true);
    expect((result as any).exportBundle.format).toBe('encrypted_mnemonic');
    const createPayload = dbGateway.createWallet.mock.calls[0][0];
    expect(createPayload.metadata.exportFormat).toBe('encrypted_mnemonic');
    expect(createPayload.metadata.ciphertext).toBeUndefined();
    expect(createPayload.metadata.authTag).toBeUndefined();
    expect(createPayload.metadata.salt).toBeUndefined();
    expect(createPayload.metadata.iv).toBeUndefined();
    expect(createPayload.metadata.creationSource).toBe('panorama_export');
  });

  it('fails fast for unsupported export chain scope', async () => {
    const { service } = createService();

    await expect(
      service.createWalletExport({
        userId: 'u1',
        chain: 'ton',
        chainScope: 'ton',
        exportPassword: 'password-123',
      })
    ).rejects.toMatchObject({ code: 'WALLET_EXPORT_CHAIN_UNSUPPORTED', status: 501 });
  });

  it('rejects short wallet export passwords', async () => {
    const { service } = createService();

    await expect(
      service.createWalletExport({
        userId: 'u1',
        chain: 'base',
        chainScope: 'evm',
        exportPassword: 'short',
      })
    ).rejects.toMatchObject({ code: 'WALLET_EXPORT_PASSWORD_INVALID', status: 400 });
  });

  it('rejects WDK wallet creation and requires linking', async () => {
    const { service } = createService();

    await expect(
      service.createWallet({
        userId: 'u1',
        chain: 'base',
        walletType: 'evm',
        provider: 'wdk',
      })
    ).rejects.toMatchObject({ code: 'WDK_LINK_REQUIRED', status: 409 });
  });

  it('creates wallet with wdk as default provider', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.createWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet' });

    const wallet = await service.createWallet({
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      provider: 'thirdweb',
    });

    expect(adapter.createWallet).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', chain: 'base' }));
    expect(wallet.id).toBe('w1');
  });

  it('creates wallet with configured default provider', async () => {
    const { dbGateway, adapter } = createService();
    const service = new PanoramaV1Service(
      dbGateway,
      { prepareSwap: jest.fn() } as any,
      { stake: jest.fn() } as any,
      { getMarkets: jest.fn(), act: jest.fn() } as any,
      { getPosition: jest.fn(), prepareStake: jest.fn(), prepareRequestUnlock: jest.fn(), prepareRedeem: jest.fn() } as any,
      { thirdweb: adapter, wdk: adapter } as any,
      'thirdweb'
    );
    dbGateway.createWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet' });

    await service.createWallet({
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
    });

    expect(adapter.createWallet).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', chain: 'base' }));
  });

  it('links a WDK wallet and stores provider metadata', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.findWalletByUserAndAddress = jest.fn().mockResolvedValue(null);
    dbGateway.createWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet' });

    const wallet = await service.linkWallet({
      userId: 'u1',
      chain: 'base',
      address: '0xwallet',
      walletType: 'evm',
      provider: 'wdk',
      providerWalletId: 'pw1',
    });

    expect(adapter.linkWallet).toHaveBeenCalledWith(expect.objectContaining({ address: '0xwallet', providerWalletId: 'pw1' }));
    expect(dbGateway.createWallet).toHaveBeenCalled();
    expect(wallet.id).toBe('w1');
  });

  it('preserves existing wallet metadata when re-linking the same wallet', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.findWalletByUserAndAddress = jest.fn().mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'ton',
      walletType: 'ton',
      address: 'EQ-existing-wallet',
      metadata: {
        provider: 'wdk',
        providerWalletId: 'pw-old',
        ownershipVerified: true,
        ownershipProof: { method: 'ton', verifiedAt: '2026-03-16T10:00:00.000Z' },
        wdk: {
          session: {
            sessionId: 'sess-1',
            capabilities: ['sign_intent', 'execute_swap'],
          },
        },
        customFlag: 'keep-me',
        overwritten: 'old',
      },
    });
    dbGateway.updateWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: 'EQ-existing-wallet' });
    adapter.linkWallet.mockResolvedValue({
      providerWalletId: 'pw-new',
      address: 'EQ-existing-wallet',
      metadata: { mode: 'client-managed', overwritten: 'provider' },
    });

    await service.linkWallet({
      userId: 'u1',
      chain: 'ton',
      address: 'EQ-existing-wallet',
      walletType: 'ton',
      provider: 'wdk',
      publicKey: '0x' + '11'.repeat(32),
      metadata: { overwritten: 'request', relinked: true },
    });

    expect(dbGateway.updateWallet).toHaveBeenCalledWith('w1', {
      metadata: expect.objectContaining({
        provider: 'wdk',
        providerWalletId: 'pw-new',
        ownershipVerified: true,
        ownershipProof: { method: 'ton', verifiedAt: '2026-03-16T10:00:00.000Z' },
        wdk: {
          session: {
            sessionId: 'sess-1',
            capabilities: ['sign_intent', 'execute_swap'],
          },
        },
        customFlag: 'keep-me',
        overwritten: 'request',
        relinked: true,
        publicKey: '0x' + '11'.repeat(32),
        mode: 'client-managed',
      }),
    });
  });

  it('registers a WDK session and updates wallet metadata', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true },
      tenantId: 'tenant-test',
    });
    dbGateway.updateWallet.mockResolvedValue({});
    adapter.getExecutionContext.mockResolvedValue({
      walletAddress: '0xwallet',
      provider: 'wdk',
      providerWalletId: 'pw1',
      capabilities: ['sign_intent', 'execute_swap'],
    });

    await service.registerWalletSession({
      userId: 'u1',
      walletId: 'w1',
      provider: 'wdk',
      chain: 'base',
      sessionId: 'sess-1',
      capabilities: ['sign_intent', 'execute_swap'],
    });

    expect(dbGateway.updateWallet).toHaveBeenCalledWith('w1', expect.objectContaining({
      metadata: expect.objectContaining({ providerSessionId: 'sess-1' }),
    }));
  });

  it('returns wallet context for owner', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0xwallet',
      metadata: { provider: 'wdk', providerWalletId: 'pw1' },
      tenantId: 'tenant-test',
    });
    adapter.getExecutionContext.mockResolvedValue({
      walletAddress: '0xwallet',
      provider: 'wdk',
      providerWalletId: 'pw1',
      capabilities: ['sign_intent', 'execute_swap'],
    });

    const context = await service.getWalletContext('w1', 'u1');
    expect(context.provider).toBe('wdk');
    expect(context.walletId).toBe('w1');
  });

  it('returns wallet context summary fields from metadata', async () => {
    const { service, dbGateway, adapter } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0xwallet',
      metadata: {
        provider: 'wdk',
        providerWalletId: 'pw1',
        wdk: {
          chainFamily: 'evm',
          runtimeConfigured: false,
          session: {
            sessionId: 'sess-1',
            expiresAt: '2026-03-20T00:00:00.000Z',
            allowedChains: [1, 8453],
          },
        },
      },
      tenantId: 'tenant-test',
    });
    adapter.getExecutionContext.mockResolvedValue({
      walletAddress: '0xwallet',
      provider: 'wdk',
      providerWalletId: 'pw1',
      capabilities: ['sign_intent', 'execute_swap'],
    });

    const context = await service.getWalletContext('w1', 'u1');
    expect(context.sessionId).toBe('sess-1');
    expect(context.sessionExpiresAt).toBe('2026-03-20T00:00:00.000Z');
    expect(context.allowedChains).toEqual([1, 8453]);
    expect(context.chainFamily).toBe('evm');
    expect(context.executionMode).toBe('simulated');
    expect(context.runtimeConfigured).toBe(false);
  });

  it('returns wallet balances using session allowed chains by default', async () => {
    const { service, dbGateway, walletBalanceReader } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0x0000000000000000000000000000000000000001',
      metadata: {
        provider: 'wdk',
        wdk: {
          session: {
            allowedChains: [1, 8453],
          },
        },
      },
      tenantId: 'tenant-test',
    });
    walletBalanceReader.readBalances.mockResolvedValue({
      walletId: 'w1',
      userId: 'u1',
      walletAddress: '0x0000000000000000000000000000000000000001',
      chains: [],
    });

    const result = await service.getWalletBalances('w1', 'u1', {});
    expect(walletBalanceReader.readBalances).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'w1',
      userId: 'u1',
      walletAddress: '0x0000000000000000000000000000000000000001',
      allowedChains: [1, 8453],
      chainIds: undefined,
      includeZeroBalances: undefined,
    }));
    expect((result as any).walletId).toBe('w1');
  });

  it('passes chain overrides and zero-balance option to the balance reader', async () => {
    const { service, dbGateway, walletBalanceReader } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0x0000000000000000000000000000000000000001',
      metadata: { provider: 'wdk' },
      tenantId: 'tenant-test',
    });
    walletBalanceReader.readBalances.mockResolvedValue({
      walletId: 'w1',
      userId: 'u1',
      walletAddress: '0x0000000000000000000000000000000000000001',
      chains: [],
    });

    await service.getWalletBalances('w1', 'u1', {
      chainIds: [8453],
      includeZeroBalances: true,
    });
    expect(walletBalanceReader.readBalances).toHaveBeenCalledWith(expect.objectContaining({
      chainIds: [8453],
      includeZeroBalances: true,
    }));
  });

  it('creates challenge and verifies EVM wallet ownership', async () => {
    const { service, dbGateway } = createService();
    const signer = Wallet.createRandom();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: signer.address,
      metadata: { provider: 'wdk', ownershipVerified: false },
      tenantId: 'tenant-test',
    });

    const challenge = (await service.prepareOwnershipChallenge('w1', 'u1')) as any;
    dbGateway.getOwnershipChallenge.mockResolvedValue({ payload: challenge });

    const signature = await signer.signMessage(challenge.message);
    const result = await service.verifyOwnership('w1', 'u1', {
      challengeId: challenge.challengeId,
      signature,
      address: signer.address,
    });

    expect((result as any).ownershipVerified).toBe(true);
    expect(dbGateway.updateWallet).toHaveBeenCalled();
    expect(dbGateway.updateOwnershipChallenge).toHaveBeenCalled();
  });

  it('requires TON publicKey during ownership verification', async () => {
    const { service, dbGateway } = createService();
    const challenge = {
      challengeId: '22222222-2222-4222-8222-222222222222',
      walletId: 'w1',
      userId: 'u1',
      walletAddress: 'EQ-ton-wallet',
      chain: 'ton',
      walletType: 'ton',
      nonce: 'nonce',
      message: 'msg',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'pending',
    };
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'ton',
      walletType: 'ton',
      address: 'EQ-ton-wallet',
      metadata: { provider: 'wdk', ownershipVerified: false },
      tenantId: 'tenant-test',
    });
    dbGateway.getOwnershipChallenge.mockResolvedValue({ payload: challenge });

    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: 'deadbeef',
      })
    ).rejects.toMatchObject({ code: 'PUBLIC_KEY_REQUIRED', status: 400 });
  });

  it('rejects malformed TON publicKey input with controlled errors', async () => {
    const { service, dbGateway } = createService();
    const challenge = {
      challengeId: '22222222-2222-4222-8222-222222222222',
      walletId: 'w1',
      userId: 'u1',
      walletAddress: 'EQ-ton-wallet',
      chain: 'ton',
      walletType: 'ton',
      nonce: 'nonce',
      message: 'msg',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'pending',
    };
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'ton',
      walletType: 'ton',
      address: 'EQ-ton-wallet',
      metadata: { provider: 'wdk', ownershipVerified: false },
      tenantId: 'tenant-test',
    });
    dbGateway.getOwnershipChallenge.mockResolvedValue({ payload: challenge });

    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: 'deadbeef',
        publicKey: 'not-hex',
      })
    ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_SIGNATURE', status: 403 });

    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: 'deadbeef',
        publicKey: '0x1234',
      })
    ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_SIGNATURE', status: 403 });
  });

  it('rejects malformed or non-verifying TON signatures with controlled errors', async () => {
    const { service, dbGateway } = createService();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const challenge = {
      challengeId: '22222222-2222-4222-8222-222222222222',
      walletId: 'w1',
      userId: 'u1',
      walletAddress: 'EQ-ton-wallet',
      chain: 'ton',
      walletType: 'ton',
      nonce: 'nonce',
      message: 'msg',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'pending',
    };
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'ton',
      walletType: 'ton',
      address: 'EQ-ton-wallet',
      metadata: { provider: 'wdk', ownershipVerified: false },
      tenantId: 'tenant-test',
    });
    dbGateway.getOwnershipChallenge.mockResolvedValue({ payload: challenge });

    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: '',
        publicKey: publicKeyHex,
      })
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', status: 400 });

    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: '***',
        publicKey: publicKeyHex,
      })
    ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_SIGNATURE', status: 403 });

    const validButWrongSignature = sign(null, Buffer.from('different-message', 'utf8'), privateKey).toString('hex');
    await expect(
      service.verifyOwnership('w1', 'u1', {
        challengeId: challenge.challengeId,
        signature: validButWrongSignature,
        publicKey: publicKeyHex,
      })
    ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_SIGNATURE', status: 403 });
  });

  it('returns policy_denied when amount exceeds policy max', async () => {
    const { service, dbGateway } = createService();

    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '100',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });

    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed', metadata: { policyStatus: 'policy_denied' } });

    await expect(
      service.createSwap({
        userId: 'u1',
        walletId: 'w1',
        policyId: 'p1',
        provider: 'wdk',
        signedIntent: 'signed',
        swap: {
          fromChainId: 1,
          toChainId: 8453,
          fromToken: '0xfrom',
          toToken: '0xto',
          amountRaw: '101',
          amountDisplay: '101',
        },
      })
    ).rejects.toMatchObject({
      code: 'POLICY_AMOUNT_DENIED',
    });
  });

  it('creates submitted intent on valid policy', async () => {
    const { service, dbGateway, swapClient } = createService();

    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'submitted' });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);

    const result = await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(dbGateway.createIntentTransaction).toHaveBeenCalled();
    expect(dbGateway.updateIntentTransaction).toHaveBeenCalled();
    expect(swapClient.prepareSwap).toHaveBeenCalledWith(
      expect.not.objectContaining({ provider: 'wdk' }),
      expect.objectContaining({ bearerToken: undefined })
    );
    expect(swapClient.prepareSwap).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'thirdweb' }),
      expect.objectContaining({ bearerToken: undefined })
    );
    expect(result.status).toBe('submitted');
  });

  it('prepares swap without executing for client-side wallets', async () => {
    const { service, dbGateway, adapter, swapClient } = createService();
    adapter.getExecutionStrategy.mockReturnValue('client');
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    swapClient.prepareSwap.mockResolvedValue({
      txData: { to: '0x1' },
      route: {},
      estimatedOutput: '100',
      provider: 'uniswap-trading-api',
      providerDebug: { quoteId: 'quote-1' },
      expiresAt,
      minOutput: '95',
      stale: false,
    });

    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true, mode: 'client-managed' },
    });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'prepared' });

    const result = await service.prepareSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
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
    });

    expect(adapter.executePlan).not.toHaveBeenCalled();
    expect(swapClient.prepareSwap).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'thirdweb' }),
      expect.objectContaining({ bearerToken: undefined })
    );
    expect((result as any).prepared.transactions).toEqual([{ to: '0x1' }]);
    expect((result as any).prepared.provider).toBe('uniswap-trading-api');
    expect((result as any).prepared.providerDebug).toEqual({ quoteId: 'quote-1' });
    expect((result as any).prepared.expiresAt).toBe(expiresAt);
    expect((result as any).prepared.minOutput).toBe('95');
    expect((result as any).prepared.stale).toBe(false);
  });

  it('forwards explicit swap provider hints to liquid swap prepare', async () => {
    const { service, dbGateway, adapter, swapClient } = createService();
    adapter.getExecutionStrategy.mockReturnValue('client');
    swapClient.prepareSwap.mockResolvedValue({
      txData: { to: '0x1' },
      route: {},
      estimatedOutput: '100',
      provider: 'uniswap',
    });

    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true, mode: 'client-managed' },
    });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'prepared' });

    await service.prepareSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swapProviderHint: 'uniswap',
      swap: {
        fromChainId: 8453,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(swapClient.prepareSwap).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'uniswap' }),
      expect.objectContaining({ bearerToken: undefined })
    );
  });

  it('forwards user bearer token to liquid swap prepare when available', async () => {
    const { service, dbGateway, adapter, swapClient } = createService();
    adapter.getExecutionStrategy.mockReturnValue('client');
    swapClient.prepareSwap.mockResolvedValue({
      txData: { to: '0x1' },
      route: {},
      estimatedOutput: '100',
      provider: 'thirdweb',
    });

    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true, mode: 'client-managed' },
    });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'prepared' });

    await service.prepareSwap({
      userId: 'u1',
      authToken: 'user-jwt-token',
      walletId: 'w1',
      policyId: 'p1',
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
    });

    expect(swapClient.prepareSwap).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ bearerToken: 'user-jwt-token' })
    );
  });

  it('marks legacy createSwap as failed when wallet requires client execution', async () => {
    const { service, dbGateway, adapter } = createService();
    adapter.getExecutionStrategy.mockReturnValue('client');
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true, mode: 'client-managed' },
    });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed' });

    const result = await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
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
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorCode: 'CLIENT_EXECUTION_REQUIRED' })
    );
    expect(result.status).toBe('failed');
  });

  it('submits prepared swap hashes from client execution', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getIntentTransaction
      .mockResolvedValueOnce({
        id: 's1',
        userId: 'u1',
        walletId: 'w1',
        action: 'swap',
        fromChainId: 8453,
        status: 'prepared',
        metadata: { preparedExpiresAt: new Date(Date.now() + 60000).toISOString(), preparedTransactionsCount: 2 },
      })
      .mockResolvedValueOnce({
        id: 's1',
        userId: 'u1',
        walletId: 'w1',
        action: 'swap',
        fromChainId: 8453,
        status: 'partially_submitted',
        txHashes: [{ hash: '0xabc', chainId: 8453 }],
        metadata: { preparedExpiresAt: new Date(Date.now() + 60000).toISOString(), preparedTransactionsCount: 2 },
      });

    const result = await service.submitPreparedSwap({
      userId: 'u1',
      swapId: 's1',
      walletId: 'w1',
      txHashes: [{
        hash: '0xabc',
        chainId: 8453,
        materializationState: 'verified',
        materializedBy: 'hash_lookup',
        verifiedAt: '2026-03-20T17:52:21.332Z',
      }],
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'partially_submitted',
        txHashes: [expect.objectContaining({
          hash: '0xabc',
          chainId: 8453,
          materializationState: 'verified',
          materializedBy: 'hash_lookup',
        })],
      })
    );
    expect(result.status).toBe('partially_submitted');
  });

  it('keeps approval-only confirmed submissions as partially submitted when the bundle is incomplete', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      status: 'partially_submitted',
      txHashes: [
        {
          hash: '0xabc',
          chainId: 8453,
          status: 'confirmed',
          materializationState: 'verified',
          materializedBy: 'receipt',
        },
      ],
      metadata: {
        preparedTransactionsCount: 2,
        clientSubmission: {
          submittedAt: new Date().toISOString(),
        },
      },
    });
    dbGateway.updateIntentTransaction.mockImplementation(async (_id: string, payload: any) => ({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      ...payload,
    }));
    jest.spyOn(service as any, 'createChainProvider').mockReturnValue({
      getTransaction: jest.fn().mockResolvedValue({ hash: '0xabc' }),
      getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1 }),
    });

    const result = await service.getSwap('s1', 'u1');

    expect(result.status).toBe('partially_submitted');
  });

  it('downgrades stale submitted swaps whose hashes never materialize onchain', async () => {
    const { service, dbGateway } = createService();
    const staleSubmittedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      status: 'submitted',
      txHashes: [
        {
          hash: '0xmissing',
          chainId: 8453,
          status: 'submitted',
          materializationState: 'verified',
          materializedBy: 'hash_lookup',
          verifiedAt: staleSubmittedAt,
        },
      ],
      metadata: {
        clientSubmission: {
          submittedAt: staleSubmittedAt,
        },
      },
    });
    dbGateway.updateIntentTransaction.mockImplementation(async (_id: string, payload: any) => ({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      ...payload,
    }));
    jest.spyOn(service as any, 'createChainProvider').mockReturnValue({
      getTransaction: jest.fn().mockResolvedValue(null),
      getTransactionReceipt: jest.fn().mockResolvedValue(null),
    });

    const result = await service.getSwap('s1', 'u1');

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'failed',
        errorCode: 'SUBMITTED_TX_NOT_FOUND',
      })
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('SUBMITTED_TX_NOT_FOUND');
  });

  it('rejects prepared swap submission on the wrong chain', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      status: 'prepared',
      metadata: { preparedExpiresAt: new Date(Date.now() + 60000).toISOString() },
    });

    await expect(service.submitPreparedSwap({
      userId: 'u1',
      swapId: 's1',
      walletId: 'w1',
      txHashes: [{ hash: '0xabc', chainId: 1 }],
    })).rejects.toMatchObject({ code: 'SWAP_SUBMIT_CHAIN_MISMATCH', status: 409 });
  });

  it('rejects prepared swap submission after expiry', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      status: 'prepared',
      metadata: { preparedExpiresAt: new Date(Date.now() - 1000).toISOString() },
    });

    await expect(service.submitPreparedSwap({
      userId: 'u1',
      swapId: 's1',
      walletId: 'w1',
      txHashes: [{ hash: '0xabc', chainId: 8453 }],
    })).rejects.toMatchObject({ code: 'SWAP_PREPARED_EXPIRED', status: 409 });
  });

  it('uses the shared runtime config to resolve BSC reconciliation RPCs', () => {
    const { dbGateway, adapter } = createService();
    const runtimeConfig = createBridgeRuntimeConfig({
      defaultEvmRpcUrl: 'https://default.example.com',
      chainRpcUrls: {
        56: 'https://bsc.example.com',
      },
    });
    const service = new PanoramaV1Service(
      dbGateway,
      { prepareSwap: jest.fn() } as any,
      { stake: jest.fn() } as any,
      { getMarkets: jest.fn(), act: jest.fn() } as any,
      { getPosition: jest.fn(), prepareStake: jest.fn(), prepareRequestUnlock: jest.fn(), prepareRedeem: jest.fn() } as any,
      { thirdweb: adapter, wdk: adapter } as any,
      'wdk',
      { readBalances: jest.fn() } as any,
      runtimeConfig
    );

    expect((service as any).resolveRpcUrlForChain(56)).toBe('https://bsc.example.com');
  });

  it('rejects failPreparedSwap once the swap is no longer prepared', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      walletId: 'w1',
      action: 'swap',
      fromChainId: 8453,
      status: 'submitted',
      metadata: { preparedExpiresAt: new Date(Date.now() + 60000).toISOString() },
    });

    await expect(service.failPreparedSwap({
      userId: 'u1',
      swapId: 's1',
      walletId: 'w1',
      errorMessage: 'local signer failed',
    })).rejects.toMatchObject({ code: 'SWAP_FAIL_INVALID_STATE', status: 409 });
  });

  it('returns existing intent when idempotency key was already used', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue({ id: 'intent-existing', userId: 'u1', action: 'swap', status: 'confirmed' });
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent-existing', userId: 'u1', action: 'swap', status: 'confirmed' });

    const result = await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      idempotencyKey: 'idem-1',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(dbGateway.createIntentTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe('confirmed');
  });

  it('maps swap timeout to deterministic timeout error code', async () => {
    const { service, dbGateway, swapClient } = createService();

    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed' });

    const timeoutError: any = new Error('timeout of 10000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    swapClient.prepareSwap.mockRejectedValue(timeoutError);

    await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorCode: 'EXECUTION_TIMEOUT' })
    );
  });

  it('falls back provider hint when first prepare attempt fails', async () => {
    const { service, dbGateway, swapClient } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'submitted' });

    const firstError: any = new Error('temporary failure');
    firstError.code = 'ECONNABORTED';
    swapClient.prepareSwap
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce({ txData: { to: '0x1' }, route: {}, estimatedOutput: '100' });

    const result = await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(swapClient.prepareSwap).toHaveBeenCalledTimes(2);
    expect(swapClient.prepareSwap).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'thirdweb' }),
      expect.objectContaining({ bearerToken: undefined })
    );
    expect(swapClient.prepareSwap).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'uniswap-trading-api' }),
      expect.objectContaining({ bearerToken: undefined })
    );
    expect(result.status).toBe('submitted');
  });

  it('maps provider availability failures to deterministic provider-unavailable error code', async () => {
    const { service, dbGateway, swapClient } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed' });

    const unavailableError: any = new Error('getaddrinfo EAI_AGAIN liquid_swap_service');
    unavailableError.code = 'EAI_AGAIN';
    swapClient.prepareSwap.mockRejectedValue(unavailableError);

    await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
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
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorCode: 'SWAP_PROVIDER_UNAVAILABLE' })
    );
  });

  it('preserves downstream 4xx swap preparation details instead of collapsing to EXECUTION_FAILED', async () => {
    const { service, dbGateway, swapClient } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy.mockResolvedValue({
      payload: {
        id: 'p1',
        userId: 'u1',
        walletId: 'w1',
        allowedActions: ['swap'],
        allowedAssets: ['0xfrom', '0xto'],
        maxAmount: '1000',
        allowedChains: [1, 8453],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'approved',
      },
    });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed' });

    const invalidRequestError: any = new Error('Request failed with status code 400');
    invalidRequestError.response = {
      status: 400,
      data: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid input parameters provided for the swap request.',
        },
      },
    };
    swapClient.prepareSwap.mockRejectedValue(invalidRequestError);

    await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        errorCode: 'EXECUTION_INVALID_REQUEST',
        errorMessage: 'Invalid input parameters provided for the swap request.',
      })
    );
  });

  it('re-checks policy before execution and denies revoked policy', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: true } });
    dbGateway.getPolicy
      .mockResolvedValueOnce({
        payload: {
          id: 'p1',
          userId: 'u1',
          walletId: 'w1',
          allowedActions: ['swap'],
          allowedAssets: ['0xfrom', '0xto'],
          maxAmount: '1000',
          allowedChains: [1, 8453],
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          status: 'approved',
        },
      })
      .mockResolvedValueOnce({
        payload: {
          id: 'p1',
          userId: 'u1',
          walletId: 'w1',
          allowedActions: ['swap'],
          allowedAssets: ['0xfrom', '0xto'],
          maxAmount: '1000',
          allowedChains: [1, 8453],
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          status: 'revoked',
        },
      });
    dbGateway.getIntentByIdempotencyKey.mockResolvedValue(null);
    dbGateway.getIntentTransaction.mockResolvedValue({ id: 'intent', userId: 'u1', action: 'swap', status: 'failed' });

    await service.createSwap({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      swap: {
        fromChainId: 1,
        toChainId: 8453,
        fromToken: '0xfrom',
        toToken: '0xto',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorCode: 'EXECUTION_FAILED' })
    );
  });

  it('denies swap when wallet ownership is not verified', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: false } });

    await expect(
      service.createSwap({
        userId: 'u1',
        walletId: 'w1',
        policyId: 'p1',
        provider: 'wdk',
        signedIntent: 'signed',
        swap: {
          fromChainId: 1,
          toChainId: 8453,
          fromToken: '0xfrom',
          toToken: '0xto',
          amountRaw: '100',
          amountDisplay: '100',
        },
      })
    ).rejects.toMatchObject({ code: 'OWNERSHIP_NOT_VERIFIED' });
  });

  it('denies staking when wallet ownership is not verified', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: false } });

    await expect(
      service.createStake({
        userId: 'u1',
        walletId: 'w1',
        policyId: 'p1',
        provider: 'wdk',
        signedIntent: 'signed',
        stake: { chainId: 1, token: 'ETH', amountRaw: '100', amountDisplay: '100' },
      })
    ).rejects.toMatchObject({ code: 'OWNERSHIP_NOT_VERIFIED' });
  });

  it('denies lending actions when wallet ownership is not verified', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({ id: 'w1', userId: 'u1', address: '0xwallet', metadata: { provider: 'wdk', ownershipVerified: false } });

    await expect(
      service.createLendingAction({
        userId: 'u1',
        walletId: 'w1',
        policyId: 'p1',
        provider: 'wdk',
        signedIntent: 'signed',
        lending: { chainId: 1, action: 'supply', token: 'USDC', amountRaw: '100', amountDisplay: '100' },
      })
    ).rejects.toMatchObject({ code: 'OWNERSHIP_NOT_VERIFIED' });
  });

  it('prepares a liquid stake operation without changing legacy staking flow', async () => {
    const { service, dbGateway, liquidStakingClient, adapter } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'avalanche',
      walletType: 'evm',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true },
      tenantId: 'tenant-test',
    });
    dbGateway.getPolicy.mockResolvedValue({
      tenantId: 'tenant-test',
      payload: {
        id: 'p1',
        userId: 'u1',
        allowedActions: ['stake', 'request_unlock', 'redeem'],
        allowedAssets: ['avax', 'savax'],
        maxAmount: '100000000000000000000',
        allowedChains: [43114],
        expiresAt: '2099-01-01T00:00:00.000Z',
        status: 'approved',
      },
    });
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 'liq1',
      userId: 'u1',
      walletId: 'w1',
      action: 'stake',
      protocol: 'liquid-staking-v1',
      status: 'prepared',
      txHashes: [],
      metadata: {
        preparedChainId: 43114,
        preparedTransactionsCount: 1,
      },
      tenantId: 'tenant-test',
    });

    const result = await service.prepareLiquidStake({
      userId: 'u1',
      walletId: 'w1',
      policyId: 'p1',
      provider: 'wdk',
      signedIntent: 'signed',
      liquidStake: {
        chainId: 43114,
        token: 'AVAX',
        amountRaw: '100',
        amountDisplay: '100',
      },
    });

    expect(adapter.assertExecutionAllowed).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stake',
      chainId: 43114,
    }));
    expect(liquidStakingClient.prepareStake).toHaveBeenCalledWith({
      userAddress: '0xwallet',
      amount: '100',
    });
    expect((result as any).prepared.transactions).toHaveLength(1);
  });

  it('returns liquid staking positions through the dedicated client', async () => {
    const { service, dbGateway, liquidStakingClient } = createService();
    dbGateway.upsertUser.mockResolvedValue(undefined);

    const result = await service.getLiquidStakePosition({ userId: 'u1', address: '0xwallet' });

    expect(dbGateway.upsertUser).toHaveBeenCalledWith('u1');
    expect(liquidStakingClient.getPosition).toHaveBeenCalledWith('0xwallet');
    expect((result as any).sAvaxBalance).toBe('100');
  });

  it('submits prepared liquid staking tx hashes', async () => {
    const { service, dbGateway } = createService();
    dbGateway.getWallet.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      chain: 'avalanche',
      walletType: 'evm',
      address: '0xwallet',
      metadata: { provider: 'wdk', ownershipVerified: true },
      tenantId: 'tenant-test',
    });
    dbGateway.getIntentTransaction.mockResolvedValue({
      id: 'liq1',
      userId: 'u1',
      walletId: 'w1',
      action: 'stake',
      protocol: 'liquid-staking-v1',
      status: 'prepared',
      fromChainId: 43114,
      txHashes: [],
      metadata: {
        preparedChainId: 43114,
        preparedTransactionsCount: 1,
      },
      tenantId: 'tenant-test',
    });

    const result = await service.submitPreparedLiquidOperation({
      userId: 'u1',
      operationId: 'liq1',
      walletId: 'w1',
      txHashes: [{ hash: '0xabc', chainId: 43114, status: 'pending', materializationState: 'verified' } as any],
    });

    expect(dbGateway.updateIntentTransaction).toHaveBeenCalledWith('liq1', expect.objectContaining({
      status: 'submitted',
      txHashes: [expect.objectContaining({ hash: '0xabc', chainId: 43114 })],
    }));
    expect((result as any).id).toBe('liq1');
  });
});
