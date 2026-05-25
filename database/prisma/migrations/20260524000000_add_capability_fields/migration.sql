-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "capability" TEXT,
ADD COLUMN     "envelope" JSONB,
ADD COLUMN     "traceId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_capability_provider_idx" ON "Transaction"("capability", "provider");

-- CreateIndex
CREATE INDEX "Transaction_traceId_idx" ON "Transaction"("traceId");
