import {
  AuthenticatedIdentity,
  IdentityResolution,
  normalizeProviderSubject,
} from '../domain/identity';
import { IdentityRepository } from '../repositories/identityRepository';

export class IdentityResolver {
  constructor(private readonly repository: IdentityRepository) {}

  async resolve(
    tenantId: string,
    identity: AuthenticatedIdentity
  ): Promise<IdentityResolution> {
    const normalizedTenantId = tenantId.trim();

    if (!normalizedTenantId) {
      throw new Error('Tenant ID must not be empty');
    }

    const providerSubject = normalizeProviderSubject(
      identity.provider,
      identity.subject
    );

    const mappings =
      await this.repository.findByProviderSubject(
        normalizedTenantId,
        identity.provider,
        providerSubject
      );

    if (mappings.length === 0) {
      return {
        status: 'unresolved',
        tenantId: normalizedTenantId,
      };
    }

    if (mappings.length > 1) {
      return {
        status: 'integrity_error',
        tenantId: normalizedTenantId,
        reason: 'ambiguous_identity_mapping',
      };
    }

    const mapping = mappings[0];

    if (mapping.tenantId !== normalizedTenantId) {
      throw new Error(
        'Identity repository returned a mapping outside the requested tenant'
      );
    }

    if (mapping.provider !== identity.provider) {
      throw new Error(
        'Identity repository returned a mapping for a different provider'
      );
    }

    if (mapping.providerSubject !== providerSubject) {
      throw new Error(
        'Identity repository returned a mapping for a different provider subject'
      );
    }

    if (!mapping.userId.trim()) {
      throw new Error(
        'Identity repository returned a mapping without a PB user ID'
      );
    }

    return {
      status: 'resolved',
      userId: mapping.userId,
      tenantId: mapping.tenantId,
    };
  }
}
