import assert from "node:assert/strict";
import test from "node:test";
import {
  IdentityPopulationGateway,
  PopulationIdentity,
} from "../services/identityPopulationGateway";

function identity(
  index: number,
  userId = `user-${index}`
): PopulationIdentity {
  return {
    userId,
    provider: "thirdweb-evm",
    providerSubject:
      `0x${index.toString(16).padStart(40, "0")}`,
    tenantId: "panorama",
    verifiedAt: "2026-09-26T00:00:00.000Z",
    provenance: {
      source: "a7-thirdweb-evm-reconciliation",
    },
  };
}

function response(
  status: number,
  payload: unknown
): Response {
  return new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

test("writes only MISSING identities then verifies IDENTICAL", async () => {
  const proposals = [
    identity(1),
    identity(2),
    identity(3),
  ];

  let persisted = [proposals[1]];
  const writes: unknown[] = [];

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: persisted,
        });
      }

      const body = JSON.parse(
        String(init?.body)
      );
      writes.push(body);

      for (const op of body.ops) {
        persisted.push(op.args.data);
      }

      return response(200, {
        data: body.ops.map(
          (op: { args: { data: unknown } }) =>
            op.args.data
        ),
      });
    },
  });

  const report = await gateway.populate(
    proposals,
    50
  );

  assert.deepEqual(report.before, {
    proposed: 3,
    missing: 2,
    identical: 1,
    conflict: 0,
  });
  assert.equal(report.batchesExecuted, 1);
  assert.equal(report.writesExecuted, 2);
  assert.equal(writes.length, 1);
  assert.equal(
    (writes[0] as { ops: unknown[] }).ops.length,
    2
  );
  assert.deepEqual(report.after, {
    proposed: 3,
    missing: 0,
    identical: 3,
    conflict: 0,
  });
});

test("performs zero POSTs on a completed rerun", async () => {
  const proposals = [
    identity(1),
    identity(2),
  ];

  let posts = 0;

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
      }

      return response(200, {
        data: proposals,
      });
    },
  });

  const report = await gateway.populate(proposals);

  assert.equal(posts, 0);
  assert.equal(report.batchesExecuted, 0);
  assert.equal(report.writesExecuted, 0);
  assert.equal(report.after.identical, 2);
});

test("fails before POST when existing linkage conflicts", async () => {
  const proposals = [identity(1)];
  let posts = 0;

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
      }

      return response(200, {
        data: [
          identity(1, "different-user"),
        ],
      });
    },
  });

  await assert.rejects(
    () => gateway.populate(proposals),
    /blocked by 1 conflict/
  );

  assert.equal(posts, 0);
});

test("uses bounded transaction batches", async () => {
  const proposals = Array.from(
    { length: 119 },
    (_, index) => identity(index + 1)
  );

  let persisted: PopulationIdentity[] = [];
  const batchSizes: number[] = [];

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: persisted,
        });
      }

      const body = JSON.parse(
        String(init?.body)
      );

      batchSizes.push(body.ops.length);

      for (const op of body.ops) {
        persisted.push(op.args.data);
      }

      return response(200, {
        data: body.ops.map(
          (op: { args: { data: unknown } }) =>
            op.args.data
        ),
      });
    },
  });

  const report = await gateway.populate(
    proposals,
    50
  );

  assert.deepEqual(
    batchSizes,
    [50, 50, 19]
  );
  assert.equal(report.batchesExecuted, 3);
  assert.equal(report.writesExecuted, 119);
});

test("uses a stable idempotency key for identical batch content", async () => {
  const proposals = [identity(1)];
  const keys: string[] = [];

  async function execute(): Promise<void> {
    let readCount = 0;

    const gateway = new IdentityPopulationGateway({
      baseUrl: "http://gateway",
      serviceToken: "test-token",
      fetchImpl: async (_input, init) => {
        if (init?.method === "GET") {
          readCount += 1;
          return response(200, {
            data:
              readCount === 1
                ? []
                : proposals,
          });
        }

        const headers = new Headers(
          init?.headers
        );
        keys.push(
          headers.get("Idempotency-Key") ?? ""
        );

        const body = JSON.parse(
          String(init?.body)
        );

        return response(200, {
          data: body.ops.map(
            (op: { args: { data: unknown } }) =>
              op.args.data
          ),
        });
      },
    });

    await gateway.populate(proposals);
  }

  await execute();
  await execute();

  assert.equal(keys.length, 2);
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
});

test("fails acceptance when post-write state is still missing", async () => {
  const proposals = [identity(1)];

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(
          String(init?.body)
        );

        return response(200, {
          data: body.ops.map(
            (op: { args: { data: unknown } }) =>
              op.args.data
          ),
        });
      }

      return response(200, {
        data: [],
      });
    },
  });

  await assert.rejects(
    () => gateway.populate(proposals),
    /post-write reconciliation failed/
  );
});

test("rejects a Gateway identity outside requested tenant", async () => {
  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async () =>
      response(200, {
        data: [
          {
            ...identity(1),
            tenantId: "other",
          },
        ],
      }),
  });

  await assert.rejects(
    () =>
      gateway.listProviderIdentities(
        "panorama",
        "thirdweb-evm"
      ),
    /outside the requested tenant/
  );
});

test("rejects invalid Gateway list responses", async () => {
  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async () =>
      response(200, {
        data: "not-an-array",
      }),
  });

  await assert.rejects(
    () =>
      gateway.listProviderIdentities(
        "panorama",
        "thirdweb-evm"
      ),
    /invalid user-identities list response/
  );
});

test("accepts concurrent identical forward establishment after failed batch", async () => {
  const proposals = [
    identity(1),
    identity(2),
  ];

  let persisted: PopulationIdentity[] = [];
  let posts = 0;

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: persisted,
        });
      }

      posts += 1;

      const body = JSON.parse(
        String(init?.body)
      );

      persisted = body.ops.map(
        (op: { args: { data: PopulationIdentity } }) =>
          op.args.data
      );

      return response(409, {
        error: "unique_constraint",
      });
    },
  });

  const report = await gateway.populate(proposals);

  assert.equal(posts, 1);
  assert.equal(report.batchesExecuted, 0);
  assert.equal(report.writesExecuted, 0);
  assert.deepEqual(report.after, {
    proposed: 2,
    missing: 0,
    identical: 2,
    conflict: 0,
  });
});

test("retries only identities still missing after concurrent convergence", async () => {
  const proposals = [
    identity(1),
    identity(2),
    identity(3),
  ];

  let persisted: PopulationIdentity[] = [];
  const postSubjects: string[][] = [];

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: persisted,
        });
      }

      const body = JSON.parse(
        String(init?.body)
      );

      const subjects = body.ops.map(
        (op: {
          args: {
            data: PopulationIdentity;
          };
        }) => op.args.data.providerSubject
      );

      postSubjects.push(subjects);

      if (postSubjects.length === 1) {
        persisted = [proposals[0]];
        return response(409, {
          error: "unique_constraint",
        });
      }

      for (const op of body.ops) {
        persisted.push(op.args.data);
      }

      return response(200, {
        data: body.ops.map(
          (op: { args: { data: unknown } }) =>
            op.args.data
        ),
      });
    },
  });

  const report = await gateway.populate(proposals);

  assert.equal(postSubjects.length, 2);
  assert.deepEqual(
    postSubjects[0],
    proposals.map(
      (proposal) => proposal.providerSubject
    )
  );
  assert.deepEqual(
    postSubjects[1],
    proposals
      .slice(1)
      .map(
        (proposal) => proposal.providerSubject
      )
  );

  assert.equal(report.batchesExecuted, 1);
  assert.equal(report.writesExecuted, 2);
  assert.deepEqual(report.after, {
    proposed: 3,
    missing: 0,
    identical: 3,
    conflict: 0,
  });
});

test("fails closed when failed batch converges to conflicting linkage", async () => {
  const proposals = [identity(1)];
  let persisted: PopulationIdentity[] = [];
  let posts = 0;

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: persisted,
        });
      }

      posts += 1;

      persisted = [
        identity(1, "different-user"),
      ];

      return response(409, {
        error: "unique_constraint",
      });
    },
  });

  await assert.rejects(
    () => gateway.populate(proposals),
    /reconciliation found 1 conflict/
  );

  assert.equal(posts, 1);
});

test("bounds failed missing batch to two write attempts", async () => {
  const proposals = [identity(1)];
  let posts = 0;

  const gateway = new IdentityPopulationGateway({
    baseUrl: "http://gateway",
    serviceToken: "test-token",
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return response(200, {
          data: [],
        });
      }

      posts += 1;

      return response(503, {
        error: "unavailable",
      });
    },
  });

  await assert.rejects(
    () => gateway.populate(proposals),
    /HTTP 503/
  );

  assert.equal(posts, 2);
});
