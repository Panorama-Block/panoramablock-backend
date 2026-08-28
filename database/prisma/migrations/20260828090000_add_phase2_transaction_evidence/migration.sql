-- Phase 2 transaction evidence.
-- Additive migration. Existing application tables are unchanged.

CREATE TABLE "TransactionEvidence" (
    "correlationId" TEXT NOT NULL,
    "evidenceVersion" TEXT NOT NULL DEFAULT '1.0',
    "action" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "assetIn" TEXT,
    "assetOut" TEXT,
    "amountRaw" TEXT,
    "slippageBps" INTEGER,
    "intent" JSONB NOT NULL,
    "preparedPayloadHash" TEXT,
    "preparedAt" TIMESTAMP(3),
    "preparedMetadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'intent-recorded',
    "verificationStatus" TEXT,
    "errorReason" TEXT,
    "sourceService" TEXT NOT NULL DEFAULT 'execution-layer',
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "TransactionEvidence_pkey"
        PRIMARY KEY ("correlationId")
);

CREATE TABLE "TransactionEvidenceStep" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "toAddress" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "preparedStepHash" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "executionMechanism" TEXT,
    "providerMetadata" JSONB,
    "blockNumber" TEXT,
    "blockHash" TEXT,
    "receiptStatus" INTEGER,
    "fromAddress" TEXT,
    "receiptToAddress" TEXT,
    "contractAddress" TEXT,
    "gasUsed" TEXT,
    "effectiveGasPrice" TEXT,
    "logsHash" TEXT,
    "receipt" JSONB,
    "receiptRetrievedAt" TIMESTAMP(3),
    "verified" BOOLEAN,
    "receiptMatchesSubmission" BOOLEAN,
    "senderMatchesExpected" BOOLEAN,
    "destinationMatchesExpected" BOOLEAN,
    "chainMatchesExpected" BOOLEAN,
    "verificationSource" TEXT,
    "verification" JSONB,
    "verificationError" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionEvidenceStep_pkey"
        PRIMARY KEY ("id")
);

CREATE INDEX "TransactionEvidence_chainId_createdAt_idx"
    ON "TransactionEvidence"("chainId", "createdAt" DESC);

CREATE INDEX "TransactionEvidence_walletAddress_createdAt_idx"
    ON "TransactionEvidence"("walletAddress", "createdAt" DESC);

CREATE INDEX "TransactionEvidence_status_idx"
    ON "TransactionEvidence"("status");

CREATE INDEX "TransactionEvidence_tenantId_idx"
    ON "TransactionEvidence"("tenantId");

CREATE UNIQUE INDEX "TransactionEvidenceStep_correlationId_stepIndex_key"
    ON "TransactionEvidenceStep"("correlationId", "stepIndex");

CREATE INDEX "TransactionEvidenceStep_txHash_idx"
    ON "TransactionEvidenceStep"("txHash");

CREATE INDEX "TransactionEvidenceStep_chainId_txHash_idx"
    ON "TransactionEvidenceStep"("chainId", "txHash");

CREATE INDEX "TransactionEvidenceStep_correlationId_idx"
    ON "TransactionEvidenceStep"("correlationId");

CREATE INDEX "TransactionEvidenceStep_tenantId_idx"
    ON "TransactionEvidenceStep"("tenantId");

ALTER TABLE "TransactionEvidenceStep"
    ADD CONSTRAINT "TransactionEvidenceStep_correlationId_fkey"
    FOREIGN KEY ("correlationId")
    REFERENCES "TransactionEvidence"("correlationId")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
