import assert from "node:assert/strict";
import test from "node:test";
import {
  IdentityBootstrapDryRunCliDependencies,
  runIdentityBootstrapDryRunCli,
} from "../identityBootstrapDryRunCli";

const ADDRESS = "0xabcdef0000000000000000000000000000000001";
const VERIFIED_AT = "2026-09-26T12:00:00.000Z";

const PB = JSON.stringify({
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
        walletAddress: ADDRESS,
        tenantId: "panorama",
      },
    ],
    wallets: [
      {
        userId: "pb-user-1",
        address: ADDRESS,
        tenantId: "panorama",
      },
    ],
    users: [
      {
        userId: "pb-user-1",
        tenantId: "panorama",
      },
    ],
  },
  records: [
    {
      profile: {
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
});

function dependencies(
  files: Record<string, string>,
  outputs: string[]
): IdentityBootstrapDryRunCliDependencies {
  return {
    async readTextFile(path: string): Promise<string> {
      if (!(path in files)) {
        throw new Error(`Missing fixture: ${path}`);
      }

      return files[path];
    },
    writeOutput(value: string): void {
      outputs.push(value);
    },
  };
}

test("reads PB evidence and emits the historical bootstrap dry-run report", async () => {
  const outputs: string[] = [];

  await runIdentityBootstrapDryRunCli(
    ["pb.json", VERIFIED_AT],
    dependencies(
      {
        "pb.json": PB,
      },
      outputs
    )
  );

  assert.equal(outputs.length, 1);

  const report = JSON.parse(outputs[0]) as {
    mode: string;
    verifiedAt: string;
    acceptance: {
      eligibleHistoricalThirdwebEvm: number;
      provenInput: number;
      identitiesProposed: number;
      userIdentityWrites: number;
    };
  };

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.verifiedAt, VERIFIED_AT);
  assert.equal(report.acceptance.eligibleHistoricalThirdwebEvm, 1);
  assert.equal(report.acceptance.provenInput, 1);
  assert.equal(report.acceptance.identitiesProposed, 1);
  assert.equal(report.acceptance.userIdentityWrites, 0);
});

test("requires exactly the PB evidence path and verification timestamp", async () => {
  await assert.rejects(
    () =>
      runIdentityBootstrapDryRunCli(
        ["pb.json"],
        dependencies({}, [])
      ),
    /Usage:/
  );
});

test("rejects invalid PB JSON", async () => {
  await assert.rejects(
    () =>
      runIdentityBootstrapDryRunCli(
        ["pb.json", VERIFIED_AT],
        dependencies(
          {
            "pb.json": "{",
          },
          []
        )
      ),
    /PB evidence file is not valid JSON/
  );
});

test("rejects an invalid verification timestamp without emitting output", async () => {
  const outputs: string[] = [];

  await assert.rejects(
    () =>
      runIdentityBootstrapDryRunCli(
        ["pb.json", "not-a-date"],
        dependencies(
          {
            "pb.json": PB,
          },
          outputs
        )
      ),
    /verifiedAt must be a valid timestamp/
  );

  assert.equal(outputs.length, 0);
});

test("propagates PB evidence-contract failures without emitting output", async () => {
  const outputs: string[] = [];

  const invalidPb = JSON.stringify({
    schemaVersion: "2.0",
    evidenceType: "panoramablock-user-identity-wallet-evidence",
  });

  await assert.rejects(
    () =>
      runIdentityBootstrapDryRunCli(
        ["pb.json", VERIFIED_AT],
        dependencies(
          {
            "pb.json": invalidPb,
          },
          outputs
        )
      ),
    /Unsupported PB evidence schemaVersion/
  );

  assert.equal(outputs.length, 0);
});
