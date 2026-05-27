/**
 * Auth capability smoke + conformance tests.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type ProviderMetadata, type ProviderHealth } from '@panorama/capability';
import type { IAuthProvider, LoginChallenge, VerifyResult, WalletType } from '../domain/ports/auth.provider.port';

class FakeAuthProvider implements IAuthProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    private readonly route: string = 'evm'
  ) {
    this.metadata = {
      name,
      capability: 'auth',
      supportedChains: [1, 8453],
      version: '1.0.0',
      enabled: true,
    };
  }
  async login(address: string): Promise<LoginChallenge> {
    return {
      walletType: 'evm',
      payload: { address, nonce: 'test', domain: 'test', statement: '', version: '1', issuedAt: new Date().toISOString(), expirationTime: new Date(Date.now() + 300000).toISOString() },
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  }
  async verify(_payload: unknown, _signature: string): Promise<VerifyResult> {
    return { token: 'jwt-test', address: '0x1234', walletType: 'evm' };
  }
  supportsRoute(route: string): boolean {
    return route === this.route;
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
}

describe('auth provider conformance', () => {
  it('registers and retrieves by name', () => {
    const reg = new ProviderRegistry<IAuthProvider>();
    const p = new FakeAuthProvider('thirdweb-auth');
    reg.register(p);
    expect(reg.getByName('thirdweb-auth')).toBe(p);
  });

  it('rejects duplicates', () => {
    const reg = new ProviderRegistry<IAuthProvider>();
    reg.register(new FakeAuthProvider('dup'));
    expect(() => reg.register(new FakeAuthProvider('dup'))).toThrow();
  });

  it('login returns a challenge with walletType and expiry', async () => {
    const p = new FakeAuthProvider('test-auth');
    const challenge = await p.login('0xabc');
    expect(challenge.walletType).toBe('evm');
    expect(challenge.payload).toBeDefined();
    expect(challenge.expiresAt).toBeDefined();
  });

  it('verify returns walletType in result', async () => {
    const p = new FakeAuthProvider('test-auth');
    const result = await p.verify({}, '0xsig');
    expect(result.walletType).toBe('evm');
  });

  it('verify returns token and address', async () => {
    const p = new FakeAuthProvider('test-auth');
    const result = await p.verify({}, '0xsig');
    expect(result.token).toBeDefined();
    expect(result.address).toBeDefined();
  });

  it('supportsRoute dispatches by provider type', () => {
    const evm = new FakeAuthProvider('evm-auth', 'evm');
    const telegram = new FakeAuthProvider('tg-auth', 'telegram');
    expect(evm.supportsRoute('evm')).toBe(true);
    expect(evm.supportsRoute('telegram')).toBe(false);
    expect(telegram.supportsRoute('telegram')).toBe(true);
  });

  it('healthCheck returns healthy status', async () => {
    const p = new FakeAuthProvider('health-check');
    const health = await p.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.checkedAt).toBeDefined();
  });
});
