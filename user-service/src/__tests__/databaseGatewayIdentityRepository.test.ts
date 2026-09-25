import test from "node:test";
import assert from "node:assert/strict";
import {
  DatabaseGatewayIdentityRepository,
  DatabaseGatewayIdentityRepositoryError,
} from "../repositories/databaseGatewayIdentityRepository";

const BASE_URL = "http://10.20.1.4:8081/database";
const TOKEN = "service-token";
const TENANT = "panorama";
const SUBJECT = "123456789";
const USER_ID = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: USER_ID,
    provider: "telegram",
    providerSubject: SUBJECT,
    tenantId: TENANT,
    verifiedAt: "2026-09-25T19:00:00.000Z",
    createdAt: "2026-09-25T19:00:00.000Z",
    updatedAt: "2026-09-25T19:00:00.000Z",
    ...overrides,
  };
}

test("issues the exact bounded tenant-scoped Gateway query", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: `${BASE_URL}/`,
    serviceToken: TOKEN,
    timeoutMs: 1000,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({ data: [] });
    },
  });

  const result = await repository.findByProviderSubject(
    ` ${TENANT} `,
    "telegram",
    SUBJECT
  );

  assert.deepEqual(result, []);

  const url = new URL(capturedUrl);
  assert.equal(
    `${url.origin}${url.pathname}`,
    `${BASE_URL}/v1/user-identities`
  );
  assert.equal(url.searchParams.get("take"), "2");
  assert.deepEqual(
    JSON.parse(url.searchParams.get("where") || "{}"),
    {
      provider: "telegram",
      providerSubject: SUBJECT,
    }
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      JSON.parse(url.searchParams.get("where") || "{}"),
      "tenantId"
    ),
    false
  );

  assert.equal(capturedInit?.method, "GET");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["x-tenant-id"], TENANT);
});

test("returns exactly one validated identity mapping", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({ data: [validMapping()] }),
  });

  const result = await repository.findByProviderSubject(
    TENANT,
    "telegram",
    SUBJECT
  );

  assert.deepEqual(result, [
    {
      userId: USER_ID,
      provider: "telegram",
      providerSubject: SUBJECT,
      tenantId: TENANT,
    },
  ]);
});

test("returns two mappings so the resolver can fail closed", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({
        data: [
          validMapping(),
          validMapping({
            id: "22222222-2222-4222-8222-222222222222",
            userId: "0x1111111111111111111111111111111111111111",
          }),
        ],
      }),
  });

  const result = await repository.findByProviderSubject(
    TENANT,
    "telegram",
    SUBJECT
  );

  assert.equal(result.length, 2);
});

test("rejects missing Gateway URL", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: "",
    serviceToken: TOKEN,
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /DB_GATEWAY_URL is not configured/
  );
});

test("rejects missing service token", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: "",
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /DB_GATEWAY_SERVICE_TOKEN is not configured/
  );
});

test("rejects an empty tenant before making a request", async () => {
  let called = false;

  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ data: [] });
    },
  });

  await assert.rejects(
    repository.findByProviderSubject("   ", "telegram", SUBJECT),
    /Tenant ID must not be empty/
  );
  assert.equal(called, false);
});

test("rejects an invalid timeout before making a request", async () => {
  let called = false;

  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    timeoutMs: 0,
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ data: [] });
    },
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /DB_GATEWAY_TIMEOUT_MS is invalid/
  );
  assert.equal(called, false);
});

test("rejects a non-success HTTP response even with an empty data envelope", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({ data: [] }, 503),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /failed with HTTP 503/
  );
});

test("rejects invalid JSON", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      new Response("not-json", { status: 200 }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /returned invalid JSON/
  );
});

test("rejects an invalid Gateway envelope", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () => jsonResponse({ result: [] }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /invalid user-identities list response/
  );
});

test("rejects a non-object identity record", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () => jsonResponse({ data: [null] }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /Invalid user-identities record at index 0/
  );
});

test("rejects a mapping from another tenant", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({ data: [validMapping({ tenantId: "other" })] }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /outside the requested tenant/
  );
});

test("rejects a mapping for another provider", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({ data: [validMapping({ provider: "ton" })] }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /different provider/
  );
});

test("rejects a mapping for another provider subject", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({
        data: [validMapping({ providerSubject: "987654321" })],
      }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /different provider subject/
  );
});

test("rejects a mapping without a PB user ID", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () =>
      jsonResponse({ data: [validMapping({ userId: "   " })] }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /without a PB user ID/
  );
});

test("wraps network failures as repository errors", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    (error: unknown) => {
      assert.ok(
        error instanceof DatabaseGatewayIdentityRepositoryError
      );
      assert.match(
        error.message,
        /request failed: connection refused/
      );
      return true;
    }
  );
});

test("converts an aborted request into a timeout error", async () => {
  const repository = new DatabaseGatewayIdentityRepository({
    baseUrl: BASE_URL,
    serviceToken: TOKEN,
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;

        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });

  await assert.rejects(
    repository.findByProviderSubject(TENANT, "telegram", SUBJECT),
    /timed out after 5ms/
  );
});
