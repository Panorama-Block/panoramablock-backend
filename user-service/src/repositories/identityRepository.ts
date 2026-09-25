import {
  IdentityMapping,
  IdentityProvider,
} from '../domain/identity';

export interface IdentityRepository {
  findByProviderSubject(
    tenantId: string,
    provider: IdentityProvider,
    providerSubject: string
  ): Promise<IdentityMapping[]>;
}
