import type { ICapabilityProvider, ProviderHealth } from '@panorama/capability';

// ---------------------------------------------------------------------------
// Wallet type discriminator — every auth flow identifies which wallet family
// ---------------------------------------------------------------------------

export type WalletType = 'evm' | 'ton' | 'telegram';

// ---------------------------------------------------------------------------
// Login challenge — typed payload per wallet type
// ---------------------------------------------------------------------------

export interface EvmLoginPayload {
  address: string;
  nonce: string;
  domain: string;
  statement: string;
  version: string;
  issuedAt: string;
  expirationTime: string;
}

export interface TonLoginPayload {
  proof: string;
  address: string;
}

export interface LoginChallenge {
  walletType: WalletType;
  payload: EvmLoginPayload | TonLoginPayload | Record<string, unknown>;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Verify result — unified across all wallet types
// ---------------------------------------------------------------------------

export interface VerifyResult {
  token: string;
  address: string;
  walletType: WalletType;
}

// ---------------------------------------------------------------------------
// Telegram JWT exchange (mini-app flow)
// ---------------------------------------------------------------------------

export interface TelegramExchangeResult {
  token: string;
  telegramUserId: string;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IAuthProvider extends ICapabilityProvider {
  login(address: string): Promise<LoginChallenge>;
  verify(payload: unknown, signature: string): Promise<VerifyResult>;
  exchangeTelegramJWT?(initData: string): Promise<TelegramExchangeResult>;
  supportsRoute(route: string): boolean;
  healthCheck(): Promise<ProviderHealth>;
}
