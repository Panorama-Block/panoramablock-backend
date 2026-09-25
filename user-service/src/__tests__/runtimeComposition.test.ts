import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { Server } from "node:http";

test("runtime app keeps health available and resolution fails closed without Gateway configuration", async () => {
  const originalUrl = process.env.DB_GATEWAY_URL;
  const originalToken =
    process.env.DB_GATEWAY_SERVICE_TOKEN;

  delete process.env.DB_GATEWAY_URL;
  delete process.env.DB_GATEWAY_SERVICE_TOKEN;

  let server: Server | undefined;

  try {
    const { app } = await import("../index");

    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(
        0,
        "127.0.0.1",
        () => resolve(listener)
      );
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error(
        "Runtime test server did not expose a TCP address"
      );
    }

    const port = (address as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthResponse = await fetch(
      `${baseUrl}/health`
    );

    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      status: "ok",
      service: "user-service",
      version: "0.1.0",
    });

    const resolveResponse = await fetch(
      `${baseUrl}/v1/identity/resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "panorama",
        },
        body: JSON.stringify({
          provider: "telegram",
          subject: "123456789",
        }),
      }
    );

    assert.equal(resolveResponse.status, 503);
    assert.deepEqual(await resolveResponse.json(), {
      error: "identity_resolution_unavailable",
    });
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (originalUrl === undefined) {
      delete process.env.DB_GATEWAY_URL;
    } else {
      process.env.DB_GATEWAY_URL = originalUrl;
    }

    if (originalToken === undefined) {
      delete process.env.DB_GATEWAY_SERVICE_TOKEN;
    } else {
      process.env.DB_GATEWAY_SERVICE_TOKEN =
        originalToken;
    }
  }
});
