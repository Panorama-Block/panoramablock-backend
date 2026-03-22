const mockGetBalance = jest.fn();
const mockBalanceOf = jest.fn();
const mockFormatUnits = jest.fn((value: bigint | string, decimals: number) => `${value.toString()}@${decimals}`);
const mockGetAddress = jest.fn((value: string) => value);

jest.mock('ethers', () => {
  class MockJsonRpcProvider {
    constructor(_rpcUrl: string) {}
    getBalance(address: string) {
      return mockGetBalance(address);
    }
  }

  class MockContract {
    readonly address: string;

    constructor(address: string) {
      this.address = address;
    }

    balanceOf(walletAddress: string) {
      return mockBalanceOf(this.address, walletAddress);
    }
  }

  return {
    Contract: MockContract,
    JsonRpcProvider: MockJsonRpcProvider,
    formatUnits: (value: bigint | string, decimals: number) => mockFormatUnits(value, decimals),
    getAddress: (value: string) => mockGetAddress(value),
  };
});

import { WalletBalanceReader } from '../../src/application/services/WalletBalanceReader';
import { createBridgeRuntimeConfig } from '../../src/config/runtime';

describe('WalletBalanceReader', () => {
  const runtimeConfig = createBridgeRuntimeConfig({
    defaultEvmRpcUrl: 'https://rpc.default.example.com',
    chainRpcUrls: {
      1: 'https://rpc.ethereum.example.com',
      56: 'https://rpc.bsc.example.com',
      8453: 'https://mainnet.base.org',
    },
  });
  const reader = new WalletBalanceReader(runtimeConfig);
  const walletAddress = '0x4fBe56F70E8A54757788132c6644695dbaBe7127';
  const readChainBalances = (reader as any).readChainBalances.bind(reader) as (
    chainId: number,
    walletAddress: string,
    includeZeroBalances: boolean
  ) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns native and token balances when all reads succeed', async () => {
    mockGetBalance.mockResolvedValue(123n);
    mockBalanceOf.mockResolvedValue(0n);

    const result = await reader.readBalances({
      walletId: 'w1',
      userId: 'u1',
      walletAddress,
      walletType: 'evm',
      walletChain: 'base',
      chainIds: [8453],
      includeZeroBalances: true,
    });

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].nativeBalance.balanceRaw).toBe('123');
    expect(result.chains[0].tokens).toHaveLength(4);
    expect(result.chains[0].error).toBeUndefined();
  });

  it('preserves native balance and successful tokens when one token read fails', async () => {
    mockGetBalance.mockResolvedValue(5000000000000000n);
    mockBalanceOf.mockImplementation((tokenAddress: string) => {
      if (tokenAddress === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
        throw new Error('could not decode result data');
      }
      return 0n;
    });

    const chain = await readChainBalances(8453, walletAddress, true);

    expect(chain.nativeBalance.balanceRaw).toBe('5000000000000000');
    expect(chain.tokens).toHaveLength(3);
    expect(chain.error).toEqual(
      expect.objectContaining({
        code: 'BALANCE_TOKEN_PARTIAL_FAILURE',
      })
    );
    expect(chain.error?.message).toContain('USDC');
  });

  it('preserves native balance when all token reads fail', async () => {
    mockGetBalance.mockResolvedValue(42n);
    mockBalanceOf.mockImplementation(() => {
      throw new Error('bad data');
    });

    const chain = await readChainBalances(8453, walletAddress, true);

    expect(chain.nativeBalance.balanceRaw).toBe('42');
    expect(chain.tokens).toEqual([]);
    expect(chain.error).toEqual(
      expect.objectContaining({
        code: 'BALANCE_TOKEN_PARTIAL_FAILURE',
      })
    );
  });

  it('returns full lookup failure when native balance read fails', async () => {
    mockGetBalance.mockRejectedValue(new Error('rpc unavailable'));

    const chain = await readChainBalances(8453, walletAddress, true);

    expect(chain.nativeBalance.balanceRaw).toBe('0');
    expect(chain.tokens).toEqual([]);
    expect(chain.error).toEqual({
      code: 'BALANCE_LOOKUP_FAILED',
      message: 'rpc unavailable',
    });
  });

  it('filters zero successful token balances when includeZeroBalances is false', async () => {
    mockGetBalance.mockResolvedValue(1n);
    mockBalanceOf.mockImplementation((tokenAddress: string) => {
      if (tokenAddress === '0x4200000000000000000000000000000000000006') {
        return 7n;
      }
      if (tokenAddress === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
        throw new Error('bad data');
      }
      return 0n;
    });

    const chain = await readChainBalances(8453, walletAddress, false);

    expect(chain.nativeBalance.balanceRaw).toBe('1');
    expect(chain.tokens).toHaveLength(1);
    expect(chain.tokens[0].tokenAddress).toBe('0x4200000000000000000000000000000000000006');
    expect(chain.error?.code).toBe('BALANCE_TOKEN_PARTIAL_FAILURE');
  });

  it('leaves Ethereum behavior unchanged when reads succeed', async () => {
    mockGetBalance.mockResolvedValue(10n);
    mockBalanceOf.mockResolvedValue(0n);

    const result = await reader.readBalances({
      walletId: 'w1',
      userId: 'u1',
      walletAddress,
      walletType: 'evm',
      walletChain: 'ethereum',
      chainIds: [1],
      includeZeroBalances: true,
    });

    expect(result.chains[0].chainId).toBe(1);
    expect(result.chains[0].nativeBalance.balanceRaw).toBe('10');
    expect(result.chains[0].error).toBeUndefined();
  });

  it('reads BSC through the shared runtime config resolver', async () => {
    mockGetBalance.mockResolvedValue(5n);
    mockBalanceOf.mockResolvedValue(0n);

    const result = await reader.readBalances({
      walletId: 'w1',
      userId: 'u1',
      walletAddress,
      walletType: 'evm',
      walletChain: 'bsc',
      chainIds: [56],
      includeZeroBalances: true,
    });

    expect(result.chains[0].chainId).toBe(56);
    expect(result.chains[0].rpcSource).toBe('https://rpc.bsc.example.com');
  });
});
