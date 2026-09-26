export interface ProposedIdentity {
  userId: string;
  provider: string;
  providerSubject: string;
  tenantId: string;
}

export interface PersistedIdentity {
  userId: string;
  provider: string;
  providerSubject: string;
  tenantId: string;
}

export type IdentityPopulationClassification =
  | "MISSING"
  | "IDENTICAL"
  | "CONFLICT";

export interface IdentityPopulationResult {
  proposal: ProposedIdentity;
  classification: IdentityPopulationClassification;
  existing: PersistedIdentity[];
}

export interface IdentityPopulationReconciliation {
  results: IdentityPopulationResult[];
  summary: {
    proposed: number;
    missing: number;
    identical: number;
    conflict: number;
  };
  canWrite: boolean;
}

function identityKey(identity: {
  tenantId: string;
  provider: string;
  providerSubject: string;
}): string {
  return JSON.stringify([
    identity.tenantId,
    identity.provider,
    identity.providerSubject,
  ]);
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function validateIdentity(
  identity: ProposedIdentity | PersistedIdentity,
  name: string
): void {
  requireNonEmpty(identity.userId, `${name}.userId`);
  requireNonEmpty(identity.provider, `${name}.provider`);
  requireNonEmpty(identity.providerSubject, `${name}.providerSubject`);
  requireNonEmpty(identity.tenantId, `${name}.tenantId`);
}

export function reconcileIdentityPopulation(
  proposals: ProposedIdentity[],
  persisted: PersistedIdentity[]
): IdentityPopulationReconciliation {
  const proposalKeys = new Set<string>();

  proposals.forEach((proposal, index) => {
    validateIdentity(proposal, `proposals[${index}]`);

    const key = identityKey(proposal);
    if (proposalKeys.has(key)) {
      throw new Error(
        `Duplicate proposed identity for ${proposal.tenantId}/${proposal.provider}/${proposal.providerSubject}`
      );
    }
    proposalKeys.add(key);
  });

  const persistedByKey = new Map<string, PersistedIdentity[]>();

  persisted.forEach((identity, index) => {
    validateIdentity(identity, `persisted[${index}]`);

    const key = identityKey(identity);
    const existing = persistedByKey.get(key) ?? [];
    existing.push(identity);
    persistedByKey.set(key, existing);
  });

  const results = proposals.map((proposal): IdentityPopulationResult => {
    const existing = persistedByKey.get(identityKey(proposal)) ?? [];

    if (existing.length === 0) {
      return {
        proposal,
        classification: "MISSING",
        existing,
      };
    }

    if (
      existing.length === 1 &&
      existing[0].userId === proposal.userId
    ) {
      return {
        proposal,
        classification: "IDENTICAL",
        existing,
      };
    }

    return {
      proposal,
      classification: "CONFLICT",
      existing,
    };
  });

  const summary = {
    proposed: results.length,
    missing: results.filter(
      (result) => result.classification === "MISSING"
    ).length,
    identical: results.filter(
      (result) => result.classification === "IDENTICAL"
    ).length,
    conflict: results.filter(
      (result) => result.classification === "CONFLICT"
    ).length,
  };

  return {
    results,
    summary,
    canWrite: summary.conflict === 0,
  };
}
