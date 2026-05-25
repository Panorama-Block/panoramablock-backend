import type { ICapabilityProvider, ProviderHealth } from '@panorama/capability';

export interface LoginChallenge {
  payload: unknown;
  expiresAt: string;
}

export interface VerifyResult {
  token: string;
  address: string;
}

export interface TelegramExchangeResult {
  token: string;
  telegramUserId: string;
}

/**
 * Port for authentication providers. Adapters implement login (EVM wallet challenge/response)
 * or telegram JWT exchange — never both. Use supportsRoute() to dispatch.
 */
export interface IAuthProvider extends ICapabilityProvider {
  login(address: string): Promise<LoginChallenge>;
  verify(payload: unknown, signature: string): Promise<VerifyResult>;
  exchangeTelegramJWT?(initData: string): Promise<TelegramExchangeResult>;
  supportsRoute(route: string): boolean;
  healthCheck(): Promise<ProviderHealth>;
}
