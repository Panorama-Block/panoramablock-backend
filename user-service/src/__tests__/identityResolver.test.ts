import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IdentityMapping,
  IdentityProvider,
} from '../domain/identity';
import { IdentityRepository } from '../repositories/identityRepository';
import { IdentityResolver } from '../services/identityResolver';

const TENANT_ID = 'panorama';
const EVM_SUBJECT =
  '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

class StubIdentityRepository implements IdentityRepository {
  public calls: Array<{
    tenantId: string;
    provider: IdentityProvider;
    providerSubject: string;
  }> = [];

  constructor(
    private readonly mappings: IdentityMapping[]
  ) {}

  async findByProviderSubject(
    tenantId: string,
    provider: IdentityProvider,
    providerSubject: string
  ): Promise<IdentityMapping[]> {
    this.calls.push({
      tenantId,
      provider,
      providerSubject,
    });

    return this.mappings;
  }
}

test('returns unresolved when no identity mapping exists', async () => {
  const repository = new StubIdentityRepository([]);
  const resolver = new IdentityResolver(repository);

  const result = await resolver.resolve(TENANT_ID, {
    provider: 'telegram',
    subject: '123456789',
  });

  assert.deepEqual(result, {
    status: 'unresolved',
    tenantId: TENANT_ID,
  });
});

test('returns the existing PB user for exactly one mapping', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'telegram',
      providerSubject: '123456789',
      userId: EVM_SUBJECT,
      tenantId: TENANT_ID,
    },
  ]);

  const resolver = new IdentityResolver(repository);

  const result = await resolver.resolve(TENANT_ID, {
    provider: 'telegram',
    subject: '123456789',
  });

  assert.deepEqual(result, {
    status: 'resolved',
    userId: EVM_SUBJECT,
    tenantId: TENANT_ID,
  });
});

test('fails closed when more than one mapping is returned', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'telegram',
      providerSubject: '123456789',
      userId: EVM_SUBJECT,
      tenantId: TENANT_ID,
    },
    {
      provider: 'telegram',
      providerSubject: '123456789',
      userId: '0x1111111111111111111111111111111111111111',
      tenantId: TENANT_ID,
    },
  ]);

  const resolver = new IdentityResolver(repository);

  const result = await resolver.resolve(TENANT_ID, {
    provider: 'telegram',
    subject: '123456789',
  });

  assert.deepEqual(result, {
    status: 'integrity_error',
    tenantId: TENANT_ID,
    reason: 'ambiguous_identity_mapping',
  });
});

test('normalizes a Thirdweb subject before repository lookup', async () => {
  const repository = new StubIdentityRepository([]);
  const resolver = new IdentityResolver(repository);

  await resolver.resolve(TENANT_ID, {
    provider: 'thirdweb-evm',
    subject:
      '  0xAbCdEfABCDEFabcdefABCDEFabcdefABCDEFabcd  ',
  });

  assert.deepEqual(repository.calls, [
    {
      tenantId: TENANT_ID,
      provider: 'thirdweb-evm',
      providerSubject: EVM_SUBJECT,
    },
  ]);
});

test('rejects an empty tenant before repository access', async () => {
  const repository = new StubIdentityRepository([]);
  const resolver = new IdentityResolver(repository);

  await assert.rejects(
    resolver.resolve('   ', {
      provider: 'telegram',
      subject: '123456789',
    }),
    /Tenant ID must not be empty/
  );

  assert.equal(repository.calls.length, 0);
});

test('rejects a mapping from another tenant', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'telegram',
      providerSubject: '123456789',
      userId: EVM_SUBJECT,
      tenantId: 'other-tenant',
    },
  ]);

  const resolver = new IdentityResolver(repository);

  await assert.rejects(
    resolver.resolve(TENANT_ID, {
      provider: 'telegram',
      subject: '123456789',
    }),
    /outside the requested tenant/
  );
});

test('rejects a mapping for another provider', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'ton',
      providerSubject: '123456789',
      userId: EVM_SUBJECT,
      tenantId: TENANT_ID,
    },
  ]);

  const resolver = new IdentityResolver(repository);

  await assert.rejects(
    resolver.resolve(TENANT_ID, {
      provider: 'telegram',
      subject: '123456789',
    }),
    /different provider/
  );
});

test('rejects a mapping for another provider subject', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'telegram',
      providerSubject: '987654321',
      userId: EVM_SUBJECT,
      tenantId: TENANT_ID,
    },
  ]);

  const resolver = new IdentityResolver(repository);

  await assert.rejects(
    resolver.resolve(TENANT_ID, {
      provider: 'telegram',
      subject: '123456789',
    }),
    /different provider subject/
  );
});

test('rejects a mapping without a PB user ID', async () => {
  const repository = new StubIdentityRepository([
    {
      provider: 'telegram',
      providerSubject: '123456789',
      userId: '   ',
      tenantId: TENANT_ID,
    },
  ]);

  const resolver = new IdentityResolver(repository);

  await assert.rejects(
    resolver.resolve(TENANT_ID, {
      provider: 'telegram',
      subject: '123456789',
    }),
    /without a PB user ID/
  );
});
