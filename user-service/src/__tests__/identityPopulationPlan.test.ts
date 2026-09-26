import assert from "node:assert/strict";
import test from "node:test";
import {
  ProposedIdentity,
  reconcileIdentityPopulation,
} from "../services/identityPopulationReconciliation";
import {
  DEFAULT_IDENTITY_POPULATION_BATCH_SIZE,
  createIdentityPopulationPlan,
} from "../services/identityPopulationPlan";

function proposal(index: number): ProposedIdentity {
  return {
    userId: `user-${index}`,
    provider: "thirdweb-evm",
    providerSubject: `0x${index.toString(16).padStart(40, "0")}`,
    tenantId: "panorama",
  };
}

test("plans only MISSING identities", () => {
  const proposals = [proposal(1), proposal(2), proposal(3)];

  const reconciliation = reconcileIdentityPopulation(
    proposals,
    [{ ...proposals[1] }]
  );

  const plan = createIdentityPopulationPlan(reconciliation);

  assert.equal(plan.proposed, 3);
  assert.equal(plan.missing, 2);
  assert.equal(plan.identical, 1);
  assert.equal(plan.conflict, 0);
  assert.equal(plan.writesPlanned, 2);
  assert.deepEqual(
    plan.batches.flatMap((batch) => batch.identities),
    [proposals[0], proposals[2]]
  );
});

test("blocks the entire plan when any CONFLICT exists", () => {
  const proposals = [proposal(1), proposal(2)];

  const reconciliation = reconcileIdentityPopulation(
    proposals,
    [
      {
        ...proposals[1],
        userId: "different-user",
      },
    ]
  );

  assert.throws(
    () => createIdentityPopulationPlan(reconciliation),
    /blocked by 1 conflict/
  );
});

test("successful completed rerun plans zero writes", () => {
  const proposals = [proposal(1), proposal(2)];

  const reconciliation = reconcileIdentityPopulation(
    proposals,
    proposals.map((identity) => ({ ...identity }))
  );

  const plan = createIdentityPopulationPlan(reconciliation);

  assert.equal(plan.writesPlanned, 0);
  assert.equal(plan.batches.length, 0);
  assert.equal(plan.identical, 2);
});

test("uses bounded batches of 50 by default", () => {
  const proposals = Array.from({ length: 1119 }, (_, index) =>
    proposal(index + 1)
  );

  const reconciliation = reconcileIdentityPopulation(proposals, []);
  const plan = createIdentityPopulationPlan(reconciliation);

  assert.equal(
    plan.batchSize,
    DEFAULT_IDENTITY_POPULATION_BATCH_SIZE
  );
  assert.equal(plan.batchSize, 50);
  assert.equal(plan.batches.length, 23);
  assert.equal(plan.writesPlanned, 1119);

  for (const batch of plan.batches) {
    assert.ok(batch.identities.length <= 50);
  }

  assert.equal(plan.batches[0].identities.length, 50);
  assert.equal(plan.batches[21].identities.length, 50);
  assert.equal(plan.batches[22].identities.length, 19);
});

test("preserves deterministic proposal order across batches", () => {
  const proposals = Array.from({ length: 7 }, (_, index) =>
    proposal(index + 1)
  );

  const reconciliation = reconcileIdentityPopulation(proposals, []);
  const plan = createIdentityPopulationPlan(reconciliation, 3);

  assert.deepEqual(
    plan.batches.map((batch) =>
      batch.identities.map((identity) => identity.userId)
    ),
    [
      ["user-1", "user-2", "user-3"],
      ["user-4", "user-5", "user-6"],
      ["user-7"],
    ]
  );
});

test("rejects invalid batch sizes", () => {
  const reconciliation = reconcileIdentityPopulation([proposal(1)], []);

  for (const invalid of [0, -1, 1.5]) {
    assert.throws(
      () => createIdentityPopulationPlan(reconciliation, invalid),
      /batchSize must be a positive integer/
    );
  }
});
