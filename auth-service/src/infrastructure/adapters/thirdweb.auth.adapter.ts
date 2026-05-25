import type { ProviderHealth, ProviderMetadata } from '@panorama/capability';
import type { IAuthProvider, LoginChallenge, VerifyResult } from '../../domain/ports/auth.provider.port';
import { ThirdwebAuth } from '@thirdweb-dev/auth';
import { PrivateKeyWallet } from '@thirdweb-dev/auth/evm';
import { verifySignature as thirdwebVerifySignature } from 'thirdweb/auth';

export class ThirdwebAuthAdapter implements IAuthProvider {
  readonly name = 'thirdweb';
  readonly metadata: ProviderMetadata = {
    name: 'thirdweb',
    capability: 'auth',
    supportedChains: [1, 137, 8453, 43114],
    features: ['evm', 'ecdsa', 'siwe', 'session-refresh'],
    version: '1.0.0',
  };

  private instance: ThirdwebAuth | null = null;
  private readonly privateKey: string;
  private readonly domain: string;

  constructor() {
    this.privateKey = process.env.AUTH_PRIVATE_KEY ?? '';
    this.domain = process.env.AUTH_DOMAIN ?? 'panoramablock.com';
  }

  private get auth(): ThirdwebAuth {
    if (!this.instance) {
      if (!this.privateKey) throw new Error('AUTH_PRIVATE_KEY not set');
      this.instance = new ThirdwebAuth(new PrivateKeyWallet(this.privateKey), this.domain);
    }
    return this.instance;
  }

  async login(address: string): Promise<LoginChallenge> {
    const { ethers } = (await import('ethers')) as any;
    const normalized: string = ethers.utils.getAddress(address);
    const payload = await this.auth.payload({
      address: normalized,
      statement: 'Login to Panorama Block platform',
      domain: this.domain,
      version: '1',
    });
    const expiresAt: string = (payload as any).expiresAt ?? new Date(Date.now() + 600_000).toISOString();
    return { payload, expiresAt };
  }

  async verify(payload: unknown, signature: string): Promise<VerifyResult> {
    const p = payload as any;
    let address: string;
    try {
      const ok = await thirdwebVerifySignature({ message: p, signature, address: p.address });
      if (!ok) throw new Error('Signature verification failed');
      address = p.address as string;
    } catch {
      address = await this.auth.verify({ payload: p, signature }, { domain: this.domain });
    }
    const token: string = await this.auth.generate({ payload: p, signature }, { domain: this.domain });
    return { token, address };
  }

  async validateToken(token: string): Promise<unknown> {
    try {
      return await this.auth.authenticate(token, { domain: this.domain });
    } catch (err: any) {
      if (err?.message?.includes("found token with domain 'panoramablock'")) {
        return await this.auth.authenticate(token, { domain: 'panoramablock' });
      }
      throw err;
    }
  }

  supportsRoute(route: string): boolean {
    return ['login', 'verify'].includes(route);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const healthy = Boolean(this.privateKey);
    return {
      healthy,
      checkedAt: new Date().toISOString(),
      ...(healthy ? {} : { reason: 'AUTH_PRIVATE_KEY not set' }),
    };
  }
}
