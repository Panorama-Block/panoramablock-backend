import {
  IdentityBootstrapReport,
  PbUserEvidence,
  PbUserProfileEvidence,
  PbWalletEvidence,
  reconcileThirdwebEvmIdentities,
} from "./identityBootstrap";

const PB_SCHEMA_VERSION = "1.0";
const PB_EVIDENCE_TYPE = "panoramablock-user-identity-wallet-evidence";

interface PbResolvedRecord {
  profile: {
    walletAddress: string;
    tenantId: string;
  };
  validation: {
    checks: {
      identityUniquelyResolved: boolean;
      tenantRelationshipConsistent: boolean;
    };
  };
}

interface PbEstateArtifact {
  schemaVersion: string;
  evidenceType: string;
  summary: {
    profileCount: number;
    walletCount: number;
    userCount: number;
    uniquelyResolvedCount: number;
  };
  sourcePopulation: {
    profiles: PbUserProfileEvidence[];
    wallets: PbWalletEvidence[];
    users: PbUserEvidence[];
  };
  records: PbResolvedRecord[];
}

export interface IdentityBootstrapAcceptance {
  eligibleHistoricalThirdwebEvm: number;
  provenInput: number;
  targetExistingPbUsers: number;
  distinctTargetPbUsers: number;
  targetMissing: number;
  targetAmbiguous: number;
  identitiesProposed: number;
  duplicateProviderSubjects: number;
  tenantMismatches: number;
  telegramWrites: 0;
  tonWrites: 0;
  userWrites: 0;
  walletWrites: 0;
  userProfileWrites: 0;
  userIdentityWrites: 0;
}

export interface IdentityBootstrapDryRunReport {
  schemaVersion: "1.0";
  evidenceType: "panoramablock-user-identity-bootstrap-dry-run";
  mode: "DRY_RUN";
  tenantId: string;
  verifiedAt: string;
  reconciliation: IdentityBootstrapReport;
  acceptance: IdentityBootstrapAcceptance;
}

function requireObject(
  value: unknown,
  name: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(
  object: Record<string, unknown>,
  key: string,
  name: string
): string {
  const value = object[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}.${key} must be a non-empty string`);
  }

  return value;
}

function requireNumber(
  object: Record<string, unknown>,
  key: string,
  name: string
): number {
  const value = object[key];

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${name}.${key} must be a non-negative integer`);
  }

  return value;
}

function requireBoolean(
  object: Record<string, unknown>,
  key: string,
  name: string
): boolean {
  const value = object[key];

  if (typeof value !== "boolean") {
    throw new Error(`${name}.${key} must be a boolean`);
  }

  return value;
}

function requireArray(
  object: Record<string, unknown>,
  key: string,
  name: string
): unknown[] {
  const value = object[key];

  if (!Array.isArray(value)) {
    throw new Error(`${name}.${key} must be an array`);
  }

  return value;
}

function parsePbEstate(value: unknown): PbEstateArtifact {
  const root = requireObject(value, "PB evidence");

  if (requireString(root, "schemaVersion", "PB evidence") !== PB_SCHEMA_VERSION) {
    throw new Error("Unsupported PB evidence schemaVersion");
  }

  if (requireString(root, "evidenceType", "PB evidence") !== PB_EVIDENCE_TYPE) {
    throw new Error("Unexpected PB evidenceType");
  }

  const summary = requireObject(root.summary, "PB evidence.summary");
  const sourcePopulation = requireObject(
    root.sourcePopulation,
    "PB evidence.sourcePopulation"
  );

  const profilesRaw = requireArray(
    sourcePopulation,
    "profiles",
    "PB evidence.sourcePopulation"
  );
  const walletsRaw = requireArray(
    sourcePopulation,
    "wallets",
    "PB evidence.sourcePopulation"
  );
  const usersRaw = requireArray(
    sourcePopulation,
    "users",
    "PB evidence.sourcePopulation"
  );
  const recordsRaw = requireArray(root, "records", "PB evidence");

  const profileCount = requireNumber(
    summary,
    "profileCount",
    "PB evidence.summary"
  );
  const walletCount = requireNumber(
    summary,
    "walletCount",
    "PB evidence.summary"
  );
  const userCount = requireNumber(
    summary,
    "userCount",
    "PB evidence.summary"
  );
  const uniquelyResolvedCount = requireNumber(
    summary,
    "uniquelyResolvedCount",
    "PB evidence.summary"
  );

  if (
    profileCount !== profilesRaw.length ||
    walletCount !== walletsRaw.length ||
    userCount !== usersRaw.length
  ) {
    throw new Error("PB evidence summary does not match source population");
  }

  const profiles: PbUserProfileEvidence[] = profilesRaw.map((value, index) => {
    const record = requireObject(
      value,
      `PB evidence.sourcePopulation.profiles[${index}]`
    );

    return {
      walletAddress: requireString(
        record,
        "walletAddress",
        `PB evidence.sourcePopulation.profiles[${index}]`
      ),
      tenantId: requireString(
        record,
        "tenantId",
        `PB evidence.sourcePopulation.profiles[${index}]`
      ),
    };
  });

  const wallets: PbWalletEvidence[] = walletsRaw.map((value, index) => {
    const record = requireObject(
      value,
      `PB evidence.sourcePopulation.wallets[${index}]`
    );

    return {
      userId: requireString(
        record,
        "userId",
        `PB evidence.sourcePopulation.wallets[${index}]`
      ),
      address: requireString(
        record,
        "address",
        `PB evidence.sourcePopulation.wallets[${index}]`
      ),
      tenantId: requireString(
        record,
        "tenantId",
        `PB evidence.sourcePopulation.wallets[${index}]`
      ),
    };
  });

  const users: PbUserEvidence[] = usersRaw.map((value, index) => {
    const record = requireObject(
      value,
      `PB evidence.sourcePopulation.users[${index}]`
    );

    return {
      userId: requireString(
        record,
        "userId",
        `PB evidence.sourcePopulation.users[${index}]`
      ),
      tenantId: requireString(
        record,
        "tenantId",
        `PB evidence.sourcePopulation.users[${index}]`
      ),
    };
  });

  const records: PbResolvedRecord[] = recordsRaw.map((value, index) => {
    const recordName = `PB evidence.records[${index}]`;
    const record = requireObject(value, recordName);
    const profile = requireObject(record.profile, `${recordName}.profile`);
    const validation = requireObject(
      record.validation,
      `${recordName}.validation`
    );
    const checks = requireObject(
      validation.checks,
      `${recordName}.validation.checks`
    );

    return {
      profile: {
        walletAddress: requireString(
          profile,
          "walletAddress",
          `${recordName}.profile`
        ),
        tenantId: requireString(
          profile,
          "tenantId",
          `${recordName}.profile`
        ),
      },
      validation: {
        checks: {
          identityUniquelyResolved: requireBoolean(
            checks,
            "identityUniquelyResolved",
            `${recordName}.validation.checks`
          ),
          tenantRelationshipConsistent: requireBoolean(
            checks,
            "tenantRelationshipConsistent",
            `${recordName}.validation.checks`
          ),
        },
      },
    };
  });

  return {
    schemaVersion: PB_SCHEMA_VERSION,
    evidenceType: PB_EVIDENCE_TYPE,
    summary: {
      profileCount,
      walletCount,
      userCount,
      uniquelyResolvedCount,
    },
    sourcePopulation: {
      profiles,
      wallets,
      users,
    },
    records,
  };
}

export function createIdentityBootstrapDryRun(
  pbEvidence: unknown,
  verifiedAt: string
): IdentityBootstrapDryRunReport {
  const pb = parsePbEstate(pbEvidence);

  if (!verifiedAt.trim() || Number.isNaN(Date.parse(verifiedAt))) {
    throw new Error("verifiedAt must be a valid timestamp");
  }

  const eligibleRecords = pb.records.filter(
    (record) =>
      record.validation.checks.identityUniquelyResolved &&
      record.validation.checks.tenantRelationshipConsistent
  );

  if (eligibleRecords.length !== pb.summary.uniquelyResolvedCount) {
    throw new Error(
      "PB evidence uniquelyResolvedCount does not match eligible historical records"
    );
  }

  if (eligibleRecords.length === 0) {
    throw new Error("PB evidence contains no eligible historical identities");
  }

  const tenantIds = new Set(
    eligibleRecords.map((record) => record.profile.tenantId.trim())
  );

  if (tenantIds.size !== 1) {
    throw new Error(
      "Eligible historical identities must belong to exactly one tenant"
    );
  }

  const tenantId = [...tenantIds][0];

  if (!tenantId) {
    throw new Error("Eligible historical identity tenant must not be empty");
  }

  const providerSubjects = eligibleRecords.map(
    (record) => record.profile.walletAddress
  );

  const reconciliation = reconcileThirdwebEvmIdentities({
    tenantId,
    verifiedAt,
    thirdwebEvm: providerSubjects.map((address) => ({ address })),
    profiles: pb.sourcePopulation.profiles,
    wallets: pb.sourcePopulation.wallets,
    users: pb.sourcePopulation.users,
  });

  const targetUserIds = new Set(
    reconciliation.proposedIdentities.map((identity) => identity.userId)
  );

  const tenantMismatches =
    pb.sourcePopulation.profiles.filter(
      (profile) => profile.tenantId !== tenantId
    ).length +
    pb.sourcePopulation.wallets.filter(
      (wallet) => wallet.tenantId !== tenantId
    ).length +
    pb.sourcePopulation.users.filter(
      (user) => user.tenantId !== tenantId
    ).length;

  const targetMissing = reconciliation.results.filter(
    (result) => result.classification === "UNRESOLVED"
  ).length;

  const targetAmbiguous = reconciliation.results.filter(
    (result) => result.classification === "CONFLICT"
  ).length;

  return {
    schemaVersion: "1.0",
    evidenceType: "panoramablock-user-identity-bootstrap-dry-run",
    mode: "DRY_RUN",
    tenantId,
    verifiedAt,
    reconciliation,
    acceptance: {
      eligibleHistoricalThirdwebEvm: eligibleRecords.length,
      provenInput: reconciliation.summary.proven,
      targetExistingPbUsers: reconciliation.summary.proven,
      distinctTargetPbUsers: targetUserIds.size,
      targetMissing,
      targetAmbiguous,
      identitiesProposed: reconciliation.proposedIdentities.length,
      duplicateProviderSubjects: 0,
      tenantMismatches,
      telegramWrites: 0,
      tonWrites: 0,
      userWrites: 0,
      walletWrites: 0,
      userProfileWrites: 0,
      userIdentityWrites: 0,
    },
  };
}
