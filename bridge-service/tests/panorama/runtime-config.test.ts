import { createBridgeRuntimeConfig, resolveRpcUrl } from '../../src/config/runtime';

describe('Bridge runtime config', () => {
  it('resolves supported chain RPC URLs and default fallback', () => {
    const config = createBridgeRuntimeConfig({
      defaultEvmRpcUrl: 'https://default.example.com',
      chainRpcUrls: {
        1: 'https://eth.example.com',
        10: 'https://op.example.com',
        56: 'https://bsc.example.com',
        137: 'https://polygon.example.com',
        8453: 'https://base.example.com',
        42161: 'https://arb.example.com',
      },
    });

    expect(resolveRpcUrl(1, config)).toBe('https://eth.example.com');
    expect(resolveRpcUrl(10, config)).toBe('https://op.example.com');
    expect(resolveRpcUrl(56, config)).toBe('https://bsc.example.com');
    expect(resolveRpcUrl(137, config)).toBe('https://polygon.example.com');
    expect(resolveRpcUrl(8453, config)).toBe('https://base.example.com');
    expect(resolveRpcUrl(42161, config)).toBe('https://arb.example.com');
    expect(resolveRpcUrl(999999, config)).toBe('https://default.example.com');
  });
});
