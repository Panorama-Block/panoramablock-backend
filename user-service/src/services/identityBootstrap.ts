import { normalizeProviderSubject } from "../domain/identity";

export type BootstrapClassification =
  | "PROVEN"
  | "CANDIDATE"
  | "CONFLICT"
  | "UNRESOLVED";

export interface ThirdwebEvmEvidence {
  address: string;
}

export interface PbUserEvidence {
  userId: string;
  tenantId: string;
}

export interface PbWalletEvidence {
  userId: string;
  address: string;
  tenantId: string;
}

export interface PbUserProfileEvidence {
  walletAddress: string;
  tenantId: string;
}

export interface IdentityBootstrapInput {
  tenantId: string;
  verifiedAt: string;
  thirdwebEvm: ThirdwebEvmEvidence[];
  users: PbUserEvidence[];
  wallets: PbWalletEvidence[];
  profiles: PbUserProfileEvidence[];
}

export interface ProposedUserIdentity {
  tenantId: string;
  provider: "thirdweb-evm";
  providerSubject: string;
  userId: string;
  verifiedAt: string;
  provenance: {
    source: "a7-thirdweb-evm-reconciliation";
    relationship: "thirdweb-address->user-profile->wallet->user";
  };
}

export interface BootstrapResult {
  providerSubject: string;
  proposedUserId?: string;
  classification: BootstrapClassification;
  evidence: string[];
  reason: string;
  proposedIdentity?: ProposedUserIdentity;
}

export interface BootstrapSummary {
  eligible: number;
  proven: number;
  candidate: number;
  conflict: number;
  unresolved: number;
  proposed: number;
}

export interface IdentityBootstrapReport {
  tenantId: string;
  results: BootstrapResult[];
  proposedIdentities: ProposedUserIdentity[];
  summary: BootstrapSummary;
}

function normalizeAddress(value: string): string {
  const normalized = normalizeProviderSubject("thirdweb-evm", value);

  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("Invalid EVM address in identity bootstrap evidence");
  }

  return normalized;
}

function addToIndex<T>(index: Map<string, T[]>, key: string, value: T): void {
  const existing = index.get(key);

  if (existing) {
    existing.push(value);
  } else {
    index.set(key, [value]);
  }
}

function exactlyOne<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}

export function reconcileThirdwebEvmIdentities(
  input: IdentityBootstrapInput
): IdentityBootstrapReport {
  const tenantId = input.tenantId.trim();

  if (!tenantId) {
    throw new Error("Tenant ID must not be empty");
  }

  if (!input.verifiedAt.trim() || Number.isNaN(Date.parse(input.verifiedAt))) {
    throw new Error("verifiedAt must be a valid timestamp");
  }

  const subjects = input.thirdwebEvm.map((record) =>
    normalizeAddress(record.address)
  );

  if (new Set(subjects).size !== subjects.length) {
    throw new Error("Thirdweb EVM evidence contains duplicate addresses");
  }

  const profilesByAddress = new Map<string, PbUserProfileEvidence[]>();
  const walletsByAddress = new Map<string, PbWalletEvidence[]>();
  const usersById = new Map<string, PbUserEvidence[]>();

  for (const profile of input.profiles) {
    if (profile.tenantId === tenantId) {
      addToIndex(
        profilesByAddress,
        normalizeAddress(profile.walletAddress),
        profile
      );
    }
  }

  for (const wallet of input.wallets) {
    if (wallet.tenantId === tenantId) {
      addToIndex(walletsByAddress, normalizeAddress(wallet.address), wallet);
    }
  }

  for (const user of input.users) {
    if (user.tenantId === tenantId) {
      addToIndex(usersById, user.userId, user);
    }
  }

  const results: BootstrapResult[] = subjects.map((providerSubject) => {
    const profileMatches = profilesByAddress.get(providerSubject) ?? [];
    const walletMatches = walletsByAddress.get(providerSubject) ?? [];

    const evidence = [
      `thirdweb-evm:${providerSubject}`,
      `user-profile-matches:${profileMatches.length}`,
      `wallet-matches:${walletMatches.length}`,
    ];

    if (profileMatches.length > 1 || walletMatches.length > 1) {
      return {
        providerSubject,
        classification: "CONFLICT",
        evidence,
        reason: "PB estate contains ambiguous address relationships",
      };
    }

    const profile = exactlyOne(profileMatches);
    const wallet = exactlyOne(walletMatches);

    if (!profile || !wallet) {
      return {
        providerSubject,
        classification: "UNRESOLVED",
        evidence,
        reason:
          "Thirdweb address does not have exactly one tenant-scoped PB UserProfile and Wallet",
      };
    }

    const userMatches = usersById.get(wallet.userId) ?? [];
    evidence.push(`user-matches:${userMatches.length}`);

    if (userMatches.length > 1) {
      return {
        providerSubject,
        classification: "CONFLICT",
        evidence,
        reason: "Wallet target resolves to multiple PB Users",
      };
    }

    const user = exactlyOne(userMatches);

    if (!user) {
      return {
        providerSubject,
        classification: "UNRESOLVED",
        evidence,
        reason: "Wallet target does not resolve to an existing PB User",
      };
    }

    const proposedIdentity: ProposedUserIdentity = {
      tenantId,
      provider: "thirdweb-evm",
      providerSubject,
      userId: user.userId,
      verifiedAt: input.verifiedAt,
      provenance: {
        source: "a7-thirdweb-evm-reconciliation",
        relationship: "thirdweb-address->user-profile->wallet->user",
      },
    };

    return {
      providerSubject,
      proposedUserId: user.userId,
      classification: "PROVEN",
      evidence,
      reason:
        "Authenticated Thirdweb EVM subject resolves through exactly one PB UserProfile and Wallet to exactly one existing PB User",
      proposedIdentity,
    };
  });

  const proposedIdentities = results.flatMap((result) =>
    result.proposedIdentity ? [result.proposedIdentity] : []
  );

  const summary: BootstrapSummary = {
    eligible: results.length,
    proven: results.filter((result) => result.classification === "PROVEN").length,
    candidate: results.filter((result) => result.classification === "CANDIDATE").length,
    conflict: results.filter((result) => result.classification === "CONFLICT").length,
    unresolved: results.filter((result) => result.classification === "UNRESOLVED").length,
    proposed: proposedIdentities.length,
  };

  if (
    summary.proven +
      summary.candidate +
      summary.conflict +
      summary.unresolved !==
    summary.eligible
  ) {
    throw new Error("Bootstrap classification arithmetic failed");
  }

  return {
    tenantId,
    results,
    proposedIdentities,
    summary,
  };
}
