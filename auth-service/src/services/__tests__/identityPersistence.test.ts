import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IdentityPersistenceError,
  IdentityPersistenceService,
} from '../identityPersistence';

const ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

type Call = {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

function response(
  status: number,
  body: unknown
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGateway(
  initial?: {
    profiles?: Record<string, unknown>[];
    users?: Record<string, unknown>[];
    wallets?: Record<string, unknown>[];
  }
) {
  const state = {
    profiles: [...(initial?.profiles ?? [])],
    users: [...(initial?.users ?? [])],
    wallets: [...(initial?.wallets ?? [])],
  };

  const calls: Call[] = [];

  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers = new Headers(init?.headers);

    const parsedBody =
      typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : undefined;

    calls.push({
      url,
      method,
      body: parsedBody,
      idempotencyKey:
        headers.get('Idempotency-Key') || undefined,
    });

    const pathname = new URL(url).pathname;

    if (method === 'GET') {
      if (pathname.endsWith('/v1/user-profiles')) {
        return response(200, { data: state.profiles });
      }

      if (pathname.endsWith('/v1/users')) {
        return response(200, { data: state.users });
      }

      if (pathname.endsWith('/v1/wallets')) {
        return response(200, { data: state.wallets });
      }
    }

    if (method === 'POST') {
      if (pathname.endsWith('/v1/user-profiles')) {
        const record = {
          id: 'profile-1',
          ...parsedBody,
        };
        state.profiles.push(record);
        return response(201, record);
      }

      if (pathname.endsWith('/v1/users')) {
        const record = { ...parsedBody };
        state.users.push(record);
        return response(201, record);
      }

      if (pathname.endsWith('/v1/wallets')) {
        const record = {
          id: '00000000-0000-4000-8000-000000000001',
          ...parsedBody,
        };
        state.wallets.push(record);
        return response(201, record);
      }
    }

    return response(500, { error: 'unexpected request' });
  };

  return {
    state,
    calls,
    fetchImpl,
  };
}

function service(fetchImpl: typeof fetch) {
  return new IdentityPersistenceService({
    baseUrl: 'http://database-gateway/database',
    serviceToken: 'test-service-token',
    tenantId: 'panorama',
    timeoutMs: 1000,
    fetchImpl,
  });
}

test('creates UserProfile, User and Wallet for a new verified identity', async () => {
  const gateway = makeGateway();
  const result = await service(
    gateway.fetchImpl as typeof fetch
  ).ensureAuthenticatedEvmIdentity(ADDRESS.toUpperCase());

  assert.equal(result.userId, ADDRESS);
  assert.equal(result.walletAddress, ADDRESS);
  assert.equal(result.tenantId, 'panorama');

  assert.equal(gateway.state.profiles.length, 1);
  assert.equal(gateway.state.users.length, 1);
  assert.equal(gateway.state.wallets.length, 1);

  assert.equal(
    gateway.state.profiles[0].walletAddress,
    ADDRESS
  );
  assert.equal(gateway.state.users[0].userId, ADDRESS);
  assert.equal(
    gateway.state.users[0].walletAddress,
    ADDRESS
  );
  assert.equal(gateway.state.wallets[0].userId, ADDRESS);
  assert.equal(gateway.state.wallets[0].address, ADDRESS);
  assert.equal(gateway.state.wallets[0].chain, 'EVM');
  assert.equal(gateway.state.wallets[0].walletType, 'evm');

  const creates = gateway.calls.filter(
    (call) => call.method === 'POST'
  );

  assert.equal(creates.length, 3);
  assert.ok(
    creates.every((call) => Boolean(call.idempotencyKey))
  );
});

test('does not create duplicates for an existing complete identity', async () => {
  const gateway = makeGateway({
    profiles: [
      {
        id: 'profile-1',
        walletAddress: ADDRESS,
        tenantId: 'panorama',
      },
    ],
    users: [
      {
        userId: ADDRESS,
        walletAddress: ADDRESS,
        tenantId: 'panorama',
      },
    ],
    wallets: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        userId: ADDRESS,
        address: ADDRESS,
        chain: 'AVALANCHE',
        walletType: 'evm',
        tenantId: 'panorama',
      },
    ],
  });

  await service(
    gateway.fetchImpl as typeof fetch
  ).ensureAuthenticatedEvmIdentity(ADDRESS);

  assert.equal(
    gateway.calls.filter((call) => call.method === 'POST')
      .length,
    0
  );
});

test('completes a partial identity without replacing existing records', async () => {
  const gateway = makeGateway({
    profiles: [
      {
        id: 'profile-1',
        walletAddress: ADDRESS,
        tenantId: 'panorama',
      },
    ],
  });

  await service(
    gateway.fetchImpl as typeof fetch
  ).ensureAuthenticatedEvmIdentity(ADDRESS);

  assert.equal(gateway.state.profiles.length, 1);
  assert.equal(gateway.state.users.length, 1);
  assert.equal(gateway.state.wallets.length, 1);
});

test('repeated establishment is idempotent', async () => {
  const gateway = makeGateway();
  const identityService = service(
    gateway.fetchImpl as typeof fetch
  );

  await identityService.ensureAuthenticatedEvmIdentity(
    ADDRESS
  );
  await identityService.ensureAuthenticatedEvmIdentity(
    ADDRESS
  );

  assert.equal(gateway.state.profiles.length, 1);
  assert.equal(gateway.state.users.length, 1);
  assert.equal(gateway.state.wallets.length, 1);
});

test('rejects a non-panorama runtime tenant', async () => {
  const gateway = makeGateway();

  const identityService = new IdentityPersistenceService({
    baseUrl: 'http://database-gateway/database',
    serviceToken: 'test-service-token',
    tenantId: 'tenant-agent',
    timeoutMs: 1000,
    fetchImpl: gateway.fetchImpl as typeof fetch,
  });

  await assert.rejects(
    () =>
      identityService.ensureAuthenticatedEvmIdentity(
        ADDRESS
      ),
    (error: unknown) =>
      error instanceof IdentityPersistenceError &&
      error.message.includes(
        'DB_GATEWAY_TENANT_ID must be panorama'
      )
  );

  assert.equal(gateway.calls.length, 0);
});

test('rejects invalid verified EVM addresses', async () => {
  const gateway = makeGateway();

  await assert.rejects(
    () =>
      service(
        gateway.fetchImpl as typeof fetch
      ).ensureAuthenticatedEvmIdentity('not-an-address'),
    IdentityPersistenceError
  );

  assert.equal(gateway.calls.length, 0);
});

test('fails closed when the Database Gateway is unavailable', async () => {
  const failingFetch = async (): Promise<Response> => {
    throw new Error('connection refused');
  };

  await assert.rejects(
    () =>
      service(
        failingFetch as typeof fetch
      ).ensureAuthenticatedEvmIdentity(ADDRESS),
    (error: unknown) =>
      error instanceof IdentityPersistenceError &&
      error.message.includes(
        'Database Gateway request failed'
      )
  );
});

test('rejects malformed gateway list responses', async () => {
  const malformedFetch = async (): Promise<Response> =>
    response(200, { unexpected: [] });

  await assert.rejects(
    () =>
      service(
        malformedFetch as typeof fetch
      ).ensureAuthenticatedEvmIdentity(ADDRESS),
    (error: unknown) =>
      error instanceof IdentityPersistenceError &&
      error.message.includes('invalid list response')
  );
});

test('rejects conflicting existing User walletAddress', async () => {
  const gateway = makeGateway({
    profiles: [
      {
        id: 'profile-1',
        walletAddress: ADDRESS,
        tenantId: 'panorama',
      },
    ],
    users: [
      {
        userId: ADDRESS,
        walletAddress:
          '0x1111111111111111111111111111111111111111',
        tenantId: 'panorama',
      },
    ],
  });

  await assert.rejects(
    () =>
      service(
        gateway.fetchImpl as typeof fetch
      ).ensureAuthenticatedEvmIdentity(ADDRESS),
    (error: unknown) =>
      error instanceof IdentityPersistenceError &&
      error.message.includes('User walletAddress conflict')
  );

  assert.equal(gateway.state.wallets.length, 0);
});
