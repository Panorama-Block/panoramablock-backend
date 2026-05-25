-- AlterTable: add capability envelope fields to Transaction
-- These columns are nullable so existing rows are not affected (no default required).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "capability" TEXT,
  ADD COLUMN IF NOT EXISTS "traceId"    TEXT,
  ADD COLUMN IF NOT EXISTS "envelope"   JSONB;

-- Index: speed up the /v1/capability/_discovery aggregation
CREATE INDEX IF NOT EXISTS "Transaction_capability_provider_idx"
  ON "Transaction" ("capability", "provider");

-- Index: allow efficient lookup by traceId for log correlation
CREATE INDEX IF NOT EXISTS "Transaction_traceId_idx"
  ON "Transaction" ("traceId");
