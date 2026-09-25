import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import {
  AuthenticatedIdentity,
  IdentityResolution,
} from "../domain/identity";
import {
  createApp,
  IdentityResolutionService,
} from "../http/app";

const TENANT_ID = "panorama";
const PB_USER_ID =
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

class StubResolver implements IdentityResolutionService {
  public calls: Array<{
    tenantId: string;
    identity: AuthenticatedIdentity;
  }> = [];

  constructor(
    private readonly result:
      | IdentityResolution
      | Error
  ) {}

  async resolve(
    tenantId: string,
    identity: AuthenticatedIdentity
  ): Promise<IdentityResolution> {
    this.calls.push({ tenantId, identity });

    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

async function withServer(
  resolver: IdentityResolutionService,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createApp(resolver);
  const server: Server = await new Promise((resolve) => {
    const listener = app.listen(
      0,
      "127.0.0.1",
      () => resolve(listener)
    );
  });

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    const port = (address as AddressInfo).port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function postResolve(
  baseUrl: string,
  body: unknown,
  tenantId: string | null = TENANT_ID
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (tenantId !== null) {
    headers["x-tenant-id"] = tenantId;
  }

  return fetch(`${baseUrl}/v1/identity/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("returns 200 and the PB user for a resolved identity", async () => {
  const resolver = new StubResolver({
    status: "resolved",
    tenantId: TENANT_ID,
    userId: PB_USER_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: "123456789",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "resolved",
      tenantId: TENANT_ID,
      userId: PB_USER_ID,
    });
    assert.deepEqual(resolver.calls, [
      {
        tenantId: TENANT_ID,
        identity: {
          provider: "telegram",
          subject: "123456789",
        },
      },
    ]);
  });
});

test("returns 404 for an unresolved identity", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "ton",
      subject: "EQExampleAddress",
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      status: "unresolved",
      tenantId: TENANT_ID,
    });
  });
});

test("returns 409 for an ambiguous identity mapping", async () => {
  const resolver = new StubResolver({
    status: "integrity_error",
    tenantId: TENANT_ID,
    reason: "ambiguous_identity_mapping",
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: "123456789",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      status: "integrity_error",
      tenantId: TENANT_ID,
      reason: "ambiguous_identity_mapping",
    });
  });
});

test("requires x-tenant-id before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(
      baseUrl,
      {
        provider: "telegram",
        subject: "123456789",
      },
      null
    );

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects a blank tenant before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(
      baseUrl,
      {
        provider: "telegram",
        subject: "123456789",
      },
      "   "
    );

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects an unsupported provider before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "thirdweb-user",
      subject: "provider-user-id",
    });

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects a missing provider before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      subject: "123456789",
    });

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects a non-string subject before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: 123456789,
    });

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects a blank subject before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: "   ",
    });

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("rejects a non-object JSON body before calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(
      baseUrl,
      ["telegram", "123456789"]
    );

    assert.equal(response.status, 400);
    assert.equal(resolver.calls.length, 0);
  });
});

test("caller-supplied identity assertions cannot override tenant or PB user", async () => {
  const resolver = new StubResolver({
    status: "resolved",
    tenantId: TENANT_ID,
    userId: PB_USER_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: "123456789",
      tenantId: "attacker-tenant",
      userId: "attacker-user",
      walletAddress:
        "0x1111111111111111111111111111111111111111",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(resolver.calls, [
      {
        tenantId: TENANT_ID,
        identity: {
          provider: "telegram",
          subject: "123456789",
        },
      },
    ]);
    assert.deepEqual(await response.json(), {
      status: "resolved",
      tenantId: TENANT_ID,
      userId: PB_USER_ID,
    });
  });
});

test("returns 503 when identity resolution infrastructure fails", async () => {
  const resolver = new StubResolver(
    new Error("database gateway unavailable")
  );

  await withServer(resolver, async (baseUrl) => {
    const response = await postResolve(baseUrl, {
      provider: "telegram",
      subject: "123456789",
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "identity_resolution_unavailable",
    });
  });
});

test("health remains independent of identity resolution", async () => {
  const resolver = new StubResolver(
    new Error("must not be called")
  );

  await withServer(resolver, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "user-service",
      version: "0.1.0",
    });
    assert.equal(resolver.calls.length, 0);
  });
});

test("returns a bounded JSON 400 for malformed JSON without calling the resolver", async () => {
  const resolver = new StubResolver({
    status: "unresolved",
    tenantId: TENANT_ID,
  });

  await withServer(resolver, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/v1/identity/resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": TENANT_ID,
        },
        body: "{\"provider\":\"telegram\",\"subject\":",
      }
    );

    assert.equal(response.status, 400);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json\b/
    );
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "Request body contains invalid JSON",
    });
    assert.equal(resolver.calls.length, 0);
  });
});
