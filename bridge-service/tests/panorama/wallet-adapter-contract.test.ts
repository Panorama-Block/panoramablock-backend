import { ThirdwebWalletAdapter } from '../../src/infrastructure/adapters/ThirdwebWalletAdapter';
import { WdkWalletAdapter } from '../../src/infrastructure/adapters/WdkWalletAdapter';
import { createBridgeRuntimeConfig } from '../../src/config/runtime';

describe('Wallet adapter conformance', () => {
  beforeEach(() => {
    delete process.env.WDK_EVM_RPC_URL;
    delete process.env.WDK_TON_RPC_URL;
  });

  it('thirdweb adapter returns fallback execution when engine url is not configured', async () => {
    const adapter = new ThirdwebWalletAdapter('');
    expect(adapter.getExecutionStrategy({})).toBe('client');
    const result = await adapter.executePlan({
      intentId: 'intent-1',
      walletAddress: '0xwallet',
      signedIntent: 'signed',
      txData: { to: '0x1' },
      route: {},
    });

    expect(result.status).toBe('submitted');
    expect(result.txHash).toMatch(/^sim-/);
  });

  it('thirdweb adapter requires explicit delegated session metadata for delegated execution', async () => {
    const adapter = new ThirdwebWalletAdapter('https://engine.example.com');

    expect(adapter.getExecutionStrategy({})).toBe('client');
    await expect(
      adapter.assertExecutionAllowed({
        walletAddress: '0x0000000000000000000000000000000000000001',
        action: 'swap',
        chainId: 8453,
        metadata: {},
      })
    ).rejects.toMatchObject({ code: 'DELEGATED_EXECUTION_NOT_AVAILABLE', status: 409 });

    expect(
      adapter.getExecutionStrategy({
        thirdwebSession: {
          sessionId: 'tw-sess-1',
          allowedChains: [8453],
          capabilities: ['execute_swap'],
        },
      })
    ).toBe('delegated');
  });

  it('wdk adapter validates direct runtime configuration and sessions', async () => {
    const adapter = new WdkWalletAdapter({
      supportedChains: ['evm'],
      evmRpcUrl: 'https://rpc.example.com',
      simulateExecution: true,
    });
    const link = await adapter.linkWallet({
      userId: 'u1',
      chain: 'base',
      walletType: 'evm',
      address: '0x0000000000000000000000000000000000000001',
    });
    const session = await adapter.registerSession(
      {
        chain: 'base',
        sessionId: 'sess-1',
        capabilities: ['sign_intent', 'execute_swap'],
        allowedChains: [8453],
      },
      {
        providerWalletId: link.providerWalletId,
      }
    );

    await adapter.assertExecutionAllowed({
      walletAddress: '0x0000000000000000000000000000000000000001',
      action: 'swap',
      chainId: 8453,
      metadata: session.metadata,
    });
    const result = await adapter.executePlan({
      intentId: 'intent-1',
      walletAddress: '0x0000000000000000000000000000000000000001',
      signedIntent: 'signed',
      txData: { to: '0x1' },
      route: {},
      action: 'swap',
      chainId: 8453,
      walletMetadata: session.metadata,
    });

    expect(result.status).toBe('submitted');
    expect(result.txHash).toMatch(/^wdk-sim-/);
    const ctx = await adapter.getExecutionContext('0x0000000000000000000000000000000000000001', session.metadata);
    expect(ctx.provider).toBe('wdk');
    expect(ctx.capabilities).toContain('execute_swap');
  });

  it('wdk adapter keeps linked wallets client-side unless delegated session metadata exists', async () => {
    const adapter = new WdkWalletAdapter({
      supportedChains: ['evm'],
      evmRpcUrl: 'https://rpc.example.com',
      simulateExecution: true,
    });

    expect(adapter.getExecutionStrategy({ mode: 'client-managed' })).toBe('client');
    expect(
      adapter.getExecutionStrategy({
        mode: 'client-managed',
        wdk: {
          session: {
            sessionId: 'sess-1',
            capabilities: ['execute_swap'],
          },
        },
      })
    ).toBe('delegated');
  });

  it('wdk adapter requires chain configuration', () => {
    expect(() => new WdkWalletAdapter({ supportedChains: ['evm'] })).toThrow(
      'WDK_EVM_RPC_URL is required when evm support is enabled'
    );
  });

  it('wdk adapter falls back to the shared runtime config while preserving per-chain override', () => {
    process.env.WDK_RPC_56 = 'https://override.bsc.example.com';

    const adapter = new WdkWalletAdapter({
      supportedChains: ['evm'],
      evmRpcUrl: 'https://rpc.example.com',
      runtimeConfig: createBridgeRuntimeConfig({
        defaultEvmRpcUrl: 'https://default.example.com',
        chainRpcUrls: {
          56: 'https://shared.bsc.example.com',
          8453: 'https://shared.base.example.com',
        },
      }),
    });

    expect((adapter as any).resolveRpcUrl(56)).toBe('https://override.bsc.example.com');
    expect((adapter as any).resolveRpcUrl(8453)).toBe('https://shared.base.example.com');

    delete process.env.WDK_RPC_56;
  });
});
