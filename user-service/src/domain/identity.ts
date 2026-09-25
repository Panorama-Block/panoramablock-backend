export const IDENTITY_PROVIDERS = [
  'thirdweb-evm',
  'telegram',
  'ton',
] as const;

export type IdentityProvider =
  (typeof IDENTITY_PROVIDERS)[number];

export interface AuthenticatedIdentity {
  provider: IdentityProvider;
  subject: string;
}

export interface IdentityMapping {
  provider: IdentityProvider;
  providerSubject: string;
  userId: string;
  tenantId: string;
}

export type IdentityResolution =
  | {
      status: 'resolved';
      userId: string;
      tenantId: string;
    }
  | {
      status: 'unresolved';
      tenantId: string;
    }
  | {
      status: 'integrity_error';
      tenantId: string;
      reason: 'ambiguous_identity_mapping';
    };

export function isIdentityProvider(
  value: string
): value is IdentityProvider {
  return (IDENTITY_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeProviderSubject(
  provider: IdentityProvider,
  subject: string
): string {
  const normalized = subject.trim();

  if (!normalized) {
    throw new Error('Identity provider subject must not be empty');
  }

  if (provider === 'thirdweb-evm') {
    return normalized.toLowerCase();
  }

  return normalized;
}
