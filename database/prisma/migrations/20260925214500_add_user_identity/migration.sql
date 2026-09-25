CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "provenance" JSONB,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_tenantId_provider_providerSubject_key"
ON "UserIdentity"("tenantId", "provider", "providerSubject");

CREATE INDEX "UserIdentity_userId_idx"
ON "UserIdentity"("userId");

CREATE INDEX "UserIdentity_userId_provider_idx"
ON "UserIdentity"("userId", "provider");

CREATE INDEX "UserIdentity_tenantId_idx"
ON "UserIdentity"("tenantId");

ALTER TABLE "UserIdentity"
ADD CONSTRAINT "UserIdentity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE;
