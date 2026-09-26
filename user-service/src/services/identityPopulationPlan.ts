import {
  IdentityPopulationReconciliation,
  ProposedIdentity,
} from "./identityPopulationReconciliation";

export const DEFAULT_IDENTITY_POPULATION_BATCH_SIZE = 50;

export interface IdentityPopulationBatch {
  batchNumber: number;
  identities: ProposedIdentity[];
}

export interface IdentityPopulationPlan {
  proposed: number;
  missing: number;
  identical: number;
  conflict: number;
  batchSize: number;
  batches: IdentityPopulationBatch[];
  writesPlanned: number;
}

export function createIdentityPopulationPlan(
  reconciliation: IdentityPopulationReconciliation,
  batchSize = DEFAULT_IDENTITY_POPULATION_BATCH_SIZE
): IdentityPopulationPlan {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("batchSize must be a positive integer");
  }

  if (!reconciliation.canWrite || reconciliation.summary.conflict > 0) {
    throw new Error(
      `Identity population blocked by ${reconciliation.summary.conflict} conflict(s)`
    );
  }

  const missing = reconciliation.results
    .filter((result) => result.classification === "MISSING")
    .map((result) => result.proposal);

  const batches: IdentityPopulationBatch[] = [];

  for (let offset = 0; offset < missing.length; offset += batchSize) {
    batches.push({
      batchNumber: batches.length + 1,
      identities: missing.slice(offset, offset + batchSize),
    });
  }

  return {
    proposed: reconciliation.summary.proposed,
    missing: reconciliation.summary.missing,
    identical: reconciliation.summary.identical,
    conflict: reconciliation.summary.conflict,
    batchSize,
    batches,
    writesPlanned: missing.length,
  };
}
