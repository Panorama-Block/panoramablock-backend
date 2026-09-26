import assert from "node:assert/strict";
import test from "node:test";
import {
  PersistedIdentity,
  ProposedIdentity,
  reconcileIdentityPopulation,
} from "../services/identityPopulationReconciliation";

const proposal = (
  subject: string,
  userId = `user-${subject}`
): ProposedIdentity => ({
  userId,
  provider: "thirdweb-evm",
  providerSubject: subject,
  tenantId: "panorama",
});

const persisted = (
  subject: string,
  userId = `user-${subject}`
): PersistedIdentity => ({
  userId,
  provider: "thirdweb-evm",
  providerSubject: subject,
  tenantId: "panorama",
});

test("classifies absent identity as MISSING", () => {
  const result = reconcileIdentityPopulation(
    [proposal("0xaaa")],
    []
  );

  assert.deepEqual(result.summary, {
    proposed: 1,
    missing: 1,
    identical: 0,
    conflict: 0,
  });
  assert.equal(result.results[0].classification, "MISSING");
  assert.equal(result.canWrite, true);
});

test("classifies exact existing linkage as IDENTICAL", () => {
  const result = reconcileIdentityPopulation(
    [proposal("0xaaa")],
    [persisted("0xaaa")]
  );

  assert.deepEqual(result.summary, {
    proposed: 1,
    missing: 0,
    identical: 1,
    conflict: 0,
  });
  assert.equal(result.results[0].classification, "IDENTICAL");
  assert.equal(result.canWrite, true);
});

test("classifies different existing user linkage as CONFLICT", () => {
  const result = reconcileIdentityPopulation(
    [proposal("0xaaa", "expected-user")],
    [persisted("0xaaa", "different-user")]
  );

  assert.deepEqual(result.summary, {
    proposed: 1,
    missing: 0,
    identical: 0,
    conflict: 1,
  });
  assert.equal(result.results[0].classification, "CONFLICT");
  assert.equal(result.canWrite, false);
});

test("classifies duplicate persisted exact identity as CONFLICT", () => {
  const result = reconcileIdentityPopulation(
    [proposal("0xaaa")],
    [
      persisted("0xaaa"),
      persisted("0xaaa"),
    ]
  );

  assert.equal(result.results[0].classification, "CONFLICT");
  assert.equal(result.summary.conflict, 1);
  assert.equal(result.canWrite, false);
});

test("does not match identities across tenants", () => {
  const otherTenant: PersistedIdentity = {
    ...persisted("0xaaa"),
    tenantId: "other",
  };

  const result = reconcileIdentityPopulation(
    [proposal("0xaaa")],
    [otherTenant]
  );

  assert.equal(result.results[0].classification, "MISSING");
  assert.equal(result.canWrite, true);
});

test("does not match identities across providers", () => {
  const telegram: PersistedIdentity = {
    ...persisted("0xaaa"),
    provider: "telegram",
  };

  const result = reconcileIdentityPopulation(
    [proposal("0xaaa")],
    [telegram]
  );

  assert.equal(result.results[0].classification, "MISSING");
  assert.equal(result.canWrite, true);
});

test("reconciles mixed population deterministically", () => {
  const result = reconcileIdentityPopulation(
    [
      proposal("0xaaa"),
      proposal("0xbbb"),
      proposal("0xccc", "expected-ccc"),
    ],
    [
      persisted("0xbbb"),
      persisted("0xccc", "wrong-ccc"),
    ]
  );

  assert.deepEqual(result.summary, {
    proposed: 3,
    missing: 1,
    identical: 1,
    conflict: 1,
  });
  assert.deepEqual(
    result.results.map((item) => item.classification),
    ["MISSING", "IDENTICAL", "CONFLICT"]
  );
  assert.equal(result.canWrite, false);
});

test("rejects duplicate proposed provider subjects", () => {
  assert.throws(
    () =>
      reconcileIdentityPopulation(
        [
          proposal("0xaaa", "user-a"),
          proposal("0xaaa", "user-b"),
        ],
        []
      ),
    /Duplicate proposed identity/
  );
});

test("rejects malformed identity input", () => {
  assert.throws(
    () =>
      reconcileIdentityPopulation(
        [
          {
            ...proposal("0xaaa"),
            userId: "",
          },
        ],
        []
      ),
    /userId must be a non-empty string/
  );
});

test("successful rerun state is entirely IDENTICAL with zero MISSING", () => {
  const proposals = [
    proposal("0xaaa"),
    proposal("0xbbb"),
    proposal("0xccc"),
  ];

  const result = reconcileIdentityPopulation(
    proposals,
    proposals.map((item) => ({ ...item }))
  );

  assert.deepEqual(result.summary, {
    proposed: 3,
    missing: 0,
    identical: 3,
    conflict: 0,
  });
  assert.equal(result.canWrite, true);
});
