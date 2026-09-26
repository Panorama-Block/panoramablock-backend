import assert from "node:assert/strict";
import test from "node:test";
import {
  IdentityBootstrapInput,
  reconcileThirdwebEvmIdentities,
} from "../services/identityBootstrap";

const TENANT = "panorama";
const VERIFIED_AT = "2026-09-26T12:00:00.000Z";
const ADDRESS = "0xAbCdEf0000000000000000000000000000000001";
const NORMALIZED = ADDRESS.toLowerCase();
const USER_ID = "pb-user-1";

function baseInput(): IdentityBootstrapInput {
  return {
    tenantId: TENANT,
    verifiedAt: VERIFIED_AT,
    thirdwebEvm: [{ address: ADDRESS }],
    users: [{ userId: USER_ID, tenantId: TENANT }],
    wallets: [
      {
        userId: USER_ID,
        address: NORMALIZED,
        tenantId: TENANT,
      },
    ],
    profiles: [
      {
        walletAddress: ADDRESS,
        tenantId: TENANT,
      },
    ],
  };
}

test("derives a PROVEN mapping through profile, wallet and existing PB User", () => {
  const report = reconcileThirdwebEvmIdentities(baseInput());

  assert.deepEqual(report.summary, {
    eligible: 1,
    proven: 1,
    candidate: 0,
    conflict: 0,
    unresolved: 0,
    proposed: 1,
  });

  assert.equal(report.results[0].providerSubject, NORMALIZED);
  assert.equal(report.results[0].proposedUserId, USER_ID);
  assert.equal(report.results[0].classification, "PROVEN");

  assert.deepEqual(report.proposedIdentities[0], {
    tenantId: TENANT,
    provider: "thirdweb-evm",
    providerSubject: NORMALIZED,
    userId: USER_ID,
    verifiedAt: VERIFIED_AT,
    provenance: {
      source: "a7-thirdweb-evm-reconciliation",
      relationship: "thirdweb-address->user-profile->wallet->user",
    },
  });
});

test("does not derive userId from address equality", () => {
  const input = baseInput();
  input.users = [{ userId: ADDRESS, tenantId: TENANT }];

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.summary.proven, 0);
  assert.equal(report.summary.unresolved, 1);
  assert.equal(report.proposedIdentities.length, 0);
});

test("requires a matching UserProfile", () => {
  const input = baseInput();
  input.profiles = [];

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "UNRESOLVED");
  assert.equal(report.proposedIdentities.length, 0);
});

test("requires a matching Wallet", () => {
  const input = baseInput();
  input.wallets = [];

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "UNRESOLVED");
  assert.equal(report.proposedIdentities.length, 0);
});

test("requires the Wallet target to be an existing PB User", () => {
  const input = baseInput();
  input.users = [];

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "UNRESOLVED");
  assert.equal(report.proposedIdentities.length, 0);
});

test("fails closed on multiple tenant-scoped Wallet matches", () => {
  const input = baseInput();
  input.wallets.push({
    userId: "pb-user-2",
    address: ADDRESS,
    tenantId: TENANT,
  });

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "CONFLICT");
  assert.equal(report.proposedIdentities.length, 0);
});

test("ignores relationships belonging to another tenant", () => {
  const input = baseInput();
  input.wallets[0].tenantId = "other";

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "UNRESOLVED");
  assert.equal(report.proposedIdentities.length, 0);
});

test("normalizes Thirdweb EVM subjects before matching", () => {
  const input = baseInput();
  input.wallets[0].address = ADDRESS.toUpperCase();
  input.profiles[0].walletAddress = ADDRESS.toLowerCase();

  const report = reconcileThirdwebEvmIdentities(input);

  assert.equal(report.results[0].classification, "PROVEN");
  assert.equal(report.results[0].providerSubject, NORMALIZED);
});


test("rejects a malformed Thirdweb EVM subject", () => {
  const input = baseInput();
  input.thirdwebEvm[0].address = "not-an-address";

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /Invalid EVM address/
  );
});

test("rejects a malformed PB Wallet address", () => {
  const input = baseInput();
  input.wallets[0].address = "not-an-address";

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /Invalid EVM address/
  );
});

test("rejects a malformed PB UserProfile address", () => {
  const input = baseInput();
  input.profiles[0].walletAddress = "not-an-address";

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /Invalid EVM address/
  );
});
test("rejects duplicate Thirdweb EVM evidence", () => {
  const input = baseInput();
  input.thirdwebEvm.push({ address: NORMALIZED });

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /duplicate addresses/
  );
});

test("classifies every eligible identity exactly once", () => {
  const input = baseInput();
  const secondAddress = "0xabcdef0000000000000000000000000000000002";
  input.thirdwebEvm.push({ address: secondAddress });

  const report = reconcileThirdwebEvmIdentities(input);

  assert.deepEqual(report.summary, {
    eligible: 2,
    proven: 1,
    candidate: 0,
    conflict: 0,
    unresolved: 1,
    proposed: 1,
  });

  assert.equal(
    report.summary.proven +
      report.summary.candidate +
      report.summary.conflict +
      report.summary.unresolved,
    report.summary.eligible
  );
});

test("rejects an empty tenant", () => {
  const input = baseInput();
  input.tenantId = " ";

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /Tenant ID must not be empty/
  );
});

test("rejects an invalid verification timestamp", () => {
  const input = baseInput();
  input.verifiedAt = "not-a-date";

  assert.throws(
    () => reconcileThirdwebEvmIdentities(input),
    /verifiedAt must be a valid timestamp/
  );
});
