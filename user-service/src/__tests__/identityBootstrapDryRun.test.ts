import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityBootstrapDryRun } from "../services/identityBootstrapDryRun";

const ADDRESS = "0xabcdef0000000000000000000000000000000001";
const USER_ID = "pb-user-1";
const VERIFIED_AT = "2026-09-26T12:00:00.000Z";

function pbEvidence(): any {
  return {
    schemaVersion: "1.0",
    evidenceType: "panoramablock-user-identity-wallet-evidence",
    summary: {
      profileCount: 1,
      walletCount: 1,
      userCount: 1,
      uniquelyResolvedCount: 1,
    },
    sourcePopulation: {
      profiles: [
        {
          id: "profile-1",
          walletAddress: ADDRESS,
          tenantId: "panorama",
        },
      ],
      wallets: [
        {
          id: "wallet-1",
          userId: USER_ID,
          address: ADDRESS,
          tenantId: "panorama",
        },
      ],
      users: [
        {
          userId: USER_ID,
          tenantId: "panorama",
        },
      ],
    },
    records: [
      {
        profile: {
          id: "profile-1",
          walletAddress: ADDRESS,
          tenantId: "panorama",
        },
        validation: {
          checks: {
            identityUniquelyResolved: true,
            tenantRelationshipConsistent: true,
          },
        },
      },
    ],
  };
}

test("uses validated historical PB records as the eligibility boundary", () => {
  const report = createIdentityBootstrapDryRun(pbEvidence(), VERIFIED_AT);

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.tenantId, "panorama");
  assert.equal(report.verifiedAt, VERIFIED_AT);
  assert.equal(report.reconciliation.summary.proven, 1);

  assert.deepEqual(report.acceptance, {
    eligibleHistoricalThirdwebEvm: 1,
    provenInput: 1,
    targetExistingPbUsers: 1,
    distinctTargetPbUsers: 1,
    targetMissing: 0,
    targetAmbiguous: 0,
    identitiesProposed: 1,
    duplicateProviderSubjects: 0,
    tenantMismatches: 0,
    telegramWrites: 0,
    tonWrites: 0,
    userWrites: 0,
    walletWrites: 0,
    userProfileWrites: 0,
    userIdentityWrites: 0,
  });

  assert.equal(
    report.reconciliation.proposedIdentities[0].providerSubject,
    ADDRESS
  );
  assert.equal(
    report.reconciliation.proposedIdentities[0].userId,
    USER_ID
  );
});

test("does not make an extra Wallet eligible without a validated historical record", () => {
  const pb = pbEvidence();

  pb.sourcePopulation.wallets.push({
    id: "wallet-extra",
    userId: "extra-user",
    address: "0xabcdef0000000000000000000000000000000002",
    tenantId: "panorama",
  });
  pb.sourcePopulation.users.push({
    userId: "extra-user",
    tenantId: "panorama",
  });
  pb.summary.walletCount = 2;
  pb.summary.userCount = 2;

  const report = createIdentityBootstrapDryRun(pb, VERIFIED_AT);

  assert.equal(report.acceptance.eligibleHistoricalThirdwebEvm, 1);
  assert.equal(report.acceptance.identitiesProposed, 1);
});

test("does not make an extra User eligible without a validated historical record", () => {
  const pb = pbEvidence();

  pb.sourcePopulation.users.push({
    userId: "unrelated-user",
    tenantId: "panorama",
  });
  pb.summary.userCount = 2;

  const report = createIdentityBootstrapDryRun(pb, VERIFIED_AT);

  assert.equal(report.acceptance.eligibleHistoricalThirdwebEvm, 1);
  assert.equal(report.acceptance.identitiesProposed, 1);
});

test("independently revalidates Profile to Wallet to User after eligibility", () => {
  const pb = pbEvidence();
  pb.sourcePopulation.wallets = [];
  pb.summary.walletCount = 0;

  const report = createIdentityBootstrapDryRun(pb, VERIFIED_AT);

  assert.equal(report.acceptance.eligibleHistoricalThirdwebEvm, 1);
  assert.equal(report.acceptance.provenInput, 0);
  assert.equal(report.acceptance.targetMissing, 1);
  assert.equal(report.acceptance.identitiesProposed, 0);
});

test("fails closed when uniquelyResolvedCount disagrees with eligible records", () => {
  const pb = pbEvidence();
  pb.summary.uniquelyResolvedCount = 2;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /uniquelyResolvedCount does not match eligible historical records/
  );
});

test("does not admit a record whose unique-resolution validation is false", () => {
  const pb = pbEvidence();
  pb.records[0].validation.checks.identityUniquelyResolved = false;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /uniquelyResolvedCount does not match eligible historical records/
  );
});

test("does not admit a record whose tenant validation is false", () => {
  const pb = pbEvidence();
  pb.records[0].validation.checks.tenantRelationshipConsistent = false;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /uniquelyResolvedCount does not match eligible historical records/
  );
});

test("fails closed when eligible records span multiple tenants", () => {
  const pb = pbEvidence();
  const secondAddress = "0xabcdef0000000000000000000000000000000002";

  pb.sourcePopulation.profiles.push({
    walletAddress: secondAddress,
    tenantId: "other",
  });
  pb.sourcePopulation.wallets.push({
    userId: "other-user",
    address: secondAddress,
    tenantId: "other",
  });
  pb.sourcePopulation.users.push({
    userId: "other-user",
    tenantId: "other",
  });
  pb.records.push({
    profile: {
      walletAddress: secondAddress,
      tenantId: "other",
    },
    validation: {
      checks: {
        identityUniquelyResolved: true,
        tenantRelationshipConsistent: true,
      },
    },
  });
  pb.summary.profileCount = 2;
  pb.summary.walletCount = 2;
  pb.summary.userCount = 2;
  pb.summary.uniquelyResolvedCount = 2;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /exactly one tenant/
  );
});

test("rejects duplicate eligible provider subjects", () => {
  const pb = pbEvidence();

  pb.records.push(JSON.parse(JSON.stringify(pb.records[0])));
  pb.summary.uniquelyResolvedCount = 2;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /duplicate addresses/
  );
});

test("measures source-population tenant mismatches", () => {
  const pb = pbEvidence();

  pb.sourcePopulation.users.push({
    userId: "other-user",
    tenantId: "other",
  });
  pb.summary.userCount = 2;

  const report = createIdentityBootstrapDryRun(pb, VERIFIED_AT);

  assert.equal(report.acceptance.tenantMismatches, 1);
});

test("rejects an invalid bootstrap verification timestamp", () => {
  assert.throws(
    () => createIdentityBootstrapDryRun(pbEvidence(), "not-a-date"),
    /verifiedAt must be a valid timestamp/
  );
});

test("rejects the wrong PB evidence type", () => {
  const pb = pbEvidence();
  pb.evidenceType = "wrong";

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /Unexpected PB evidenceType/
  );
});

test("rejects an unsupported PB evidence schema", () => {
  const pb = pbEvidence();
  pb.schemaVersion = "2.0";

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /Unsupported PB evidence schemaVersion/
  );
});

test("rejects a PB summary that does not match its source population", () => {
  const pb = pbEvidence();
  pb.summary.profileCount = 2;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /summary does not match source population/
  );
});

test("rejects malformed historical record validation", () => {
  const pb = pbEvidence();
  delete pb.records[0].validation.checks.identityUniquelyResolved;

  assert.throws(
    () => createIdentityBootstrapDryRun(pb, VERIFIED_AT),
    /identityUniquelyResolved must be a boolean/
  );
});
