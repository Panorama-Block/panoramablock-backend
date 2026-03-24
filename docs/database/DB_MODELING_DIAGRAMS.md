# PanoramaBlock — DB Modeling Diagrams (Current + Target)

Date: 2026-02-10

This document focuses on the **DB gateway** (`panorama-block-backend/database`) and the models that matter for **staking + lending** in v1, plus the recommended “standardized” target for when we add more protocols.

Key constraints (from product):
- `protocol` should be a **string** (future-proof).
- Naming should match existing Prisma style (PascalCase models, camelCase fields, `createdAt/updatedAt`, `tenantId`).
- In the future we want Postgres schemas named `staking` and `lending`.

---

## 1) Two meanings of “schema”

1) **Postgres schemas**: namespaces like `public.*`, `staking.*`, `lending.*`  
2) **Prisma schema**: the single `schema.prisma` file defining models

You can standardize **domain naming today** (Prisma models + fields) and move to **Postgres schemas later** with a controlled migration (Prisma multi-schema).

---

## 2) Current Prisma models (high-level ERD)

Source: `panorama-block-backend/database/prisma/schema.prisma`

This is intentionally not “every column”; it’s the **relationship map**.

```mermaid
erDiagram
  User ||--o{ Conversation : has
  Conversation ||--o{ Message : has
  Message ||--o{ MessageToolCall : has

  User ||--o{ DcaSession : has
  User ||--o{ DcaHistory : has
  User ||--o{ DcaWorkflow : has
  DcaWorkflow ||--o{ DcaRun : runs

  %% Lending (Benqi v1)
  LendingMarket ||--o{ LendingPosition : has
  User ||--o{ LendingPosition : has
  User ||--o{ LendingSnapshotDaily : has
  User ||--o{ LendingTx : has

  %% Liquid staking (Lido v1)
  User ||--o{ LidoPosition : has
  User ||--o{ LidoWithdrawal : has
  User ||--o{ LidoTx : has

  User {
    string userId PK
    string walletAddress
    string tenantId
  }

  Conversation {
    string id PK
    string userId
    string conversationId
    string tenantId
  }

  Message {
    string messageId PK
    string userId
    string conversationId
    string tenantId
  }

  LendingMarket {
    string marketId PK
    int chainId
    string protocol
    string qTokenAddress
    string underlyingAddress
    string tenantId
  }

  LendingPosition {
    string positionId PK
    string userId
    string marketId
    string suppliedWei
    string borrowedWei
    bool collateralEnabled
    string tenantId
  }

  LendingSnapshotDaily {
    string snapshotId PK
    string userId
    int chainId
    datetime date
    string totalSuppliedWei
    string totalBorrowedWei
    string healthFactor
    string tenantId
  }

  LendingTx {
    string txId PK
    string userId
    int chainId
    string action
    string txHash
    string status
    string tenantId
  }

  LidoPosition {
    string positionId PK
    string userId
    int chainId
    string stethWei
    string wstethWei
    int apyBps
    string tenantId
  }

  LidoWithdrawal {
    string withdrawalId PK
    string userId
    int chainId
    string requestId
    string amountStEthWei
    bool finalized
    bool claimed
    string tenantId
  }

  LidoTx {
    string txId PK
    string userId
    int chainId
    string action
    string txHash
    string status
    string tenantId
  }
```

Observation:
- v1 already has **protocol-specific tables** for lending + Lido. That’s good for shipping quickly and keeping logic simple.

---

## 3) Target “standardized” model (recommended once we have multiple protocols)

When we add more staking providers and more lending providers, protocol-specific tables tend to multiply quickly.

At that point, we standardize into a small set of generic tables.

```mermaid
erDiagram
  User ||--o{ Wallet : has
  User ||--o{ PositionSnapshot : has
  User ||--o{ Transaction : has
  User ||--o{ Notification : has

  Wallet {
    string walletId PK
    string userId
    string chainNamespace  "EVM|TON"
    int chainId
    string address
    string walletType      "smart_wallet|eoa|ton|panorama"
    datetime createdAt
    datetime updatedAt
    string tenantId
  }

  PositionSnapshot {
    string snapshotId PK
    string userId
    string domain      "staking|lending"
    string protocol
    int chainId
    string market      "lido|benqi|aave|..."
    string assetRef    "token address or symbol"
    string positionType "stake|derivative|supply|borrow"
    string amountWei
    string accruedWei
    string healthFactor
    datetime snapshotAt
    string source      "onchain|cache"
    json metadata
    string tenantId
  }

  Transaction {
    string txId PK
    string userId
    string domain
    string protocol
    int chainId
    string action     "stake|unstake|withdraw|repay|borrow|supply|claim"
    string assetRef
    string amountWei
    string txHash
    string status     "created|submitted|pending|confirmed|failed"
    string errorMessage
    json metadata
    datetime createdAt
    datetime updatedAt
    string tenantId
  }

  Notification {
    string notificationId PK
    string userId
    string type
    json payload
    bool isRead
    datetime createdAt
    string tenantId
  }
```

Notes:
- `protocol` remains **string**.
- Protocol-specific extras (Lido withdrawal request IDs, Benqi markets entered, etc) stay in `metadata` until we truly need hard columns.

---

## 4) Standardizing into Postgres schemas `staking` / `lending`

This is a **migration**, not a refactor-in-place:

1) v1: keep tables in `public` (ship fast, fewer moving parts)
2) v1.1+: move tables into `staking.*` and `lending.*`
   - requires Prisma multi-schema
   - requires migration scripts + careful rollout

This is worth doing once the v1 product is stable and we have 2+ protocols per domain.

---

## 5) What moves where (concrete mapping)

Today these models live in `public` (default Postgres schema) because the Prisma datasource has no explicit `schemas = [...]`.

**Keep in `public`:**
- Chat/agent core: `User`, `Conversation`, `Message`, `MessageToolCall`, `AgentTurn`, `AgentSharedState`, `ConversationMemory`
- Swap/DCA: `SwapSession`, `SwapHistory`, `DcaSession`, `DcaHistory`, `DcaWorkflow`, `DcaRun`
- Infra: `Outbox`, `IdempotencyKey`

**Move to Postgres schema `staking`:**
- `LidoPosition`
- `LidoWithdrawal`
- `LidoTx`

**Move to Postgres schema `lending`:**
- `LendingMarket`
- `LendingPosition`
- `LendingSnapshotDaily`
- `LendingTx`

Rationale:
- keeps “core product” (chat/agent) stable in `public`
- isolates DeFi domain tables for future migrations / archiving / permissions
- matches your future roadmap (“add more staking and lending providers”)

Visual map:

```mermaid
flowchart LR
  subgraph public["public schema"]
    User["User + Chat + DCA + Swap + Infra tables"]
  end

  subgraph staking["staking schema"]
    LidoPosition
    LidoWithdrawal
    LidoTx
  end

  subgraph lending["lending schema"]
    LendingMarket
    LendingPosition
    LendingSnapshotDaily
    LendingTx
  end

  LidoPosition --> User
  LidoWithdrawal --> User
  LidoTx --> User

  LendingPosition --> User
  LendingTx --> User
  LendingSnapshotDaily --> User
  LendingPosition --> LendingMarket
```

---

## 6) Prisma multi-schema (how we implement safely)

### 6.1 Prisma schema changes (no data move yet)

In `panorama-block-backend/database/prisma/schema.prisma`:

1) Add the schemas list to the datasource:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "staking", "lending"]
}
```

2) Annotate the moved models:

```prisma
model LidoPosition {
  // fields...
  @@schema("staking")
}

model LendingMarket {
  // fields...
  @@schema("lending")
}
```

Notes:
- With Prisma v5.x, multi-schema is supported; if your Prisma version ever requires it, you may need `previewFeatures = ["multiSchema"]` in the generator, but **avoid enabling preview** unless Prisma forces it.
- Cross-schema relations are valid in Postgres (e.g. `staking.LidoPosition.userId` → `public.User.userId`) and Prisma supports them when multi-schema is enabled.

### 6.2 The data migration (move tables without dropping)

The risky failure mode is Prisma generating a “drop + recreate” when it sees schema changes.
We avoid that by **owning the migration SQL** for the schema move.

Migration strategy:
1) Create schemas (idempotent):
```sql
CREATE SCHEMA IF NOT EXISTS staking;
CREATE SCHEMA IF NOT EXISTS lending;
```

2) Move tables (preserves data + indexes + constraints):
```sql
ALTER TABLE public."LidoPosition"    SET SCHEMA staking;
ALTER TABLE public."LidoWithdrawal"  SET SCHEMA staking;
ALTER TABLE public."LidoTx"          SET SCHEMA staking;

ALTER TABLE public."LendingMarket"        SET SCHEMA lending;
ALTER TABLE public."LendingPosition"      SET SCHEMA lending;
ALTER TABLE public."LendingSnapshotDaily" SET SCHEMA lending;
ALTER TABLE public."LendingTx"            SET SCHEMA lending;
```

3) Confirm:
- the foreign keys still point to `public."User"` correctly
- the Prisma client reads/writes successfully through the gateway

### 6.3 DATABASE_URL gotcha (search_path)

Your gateway README currently shows a connection string with `?schema=public`.
That parameter sets the search_path and can hide other schemas.

For multi-schema, prefer:
- remove `?schema=public` from `DATABASE_URL` (recommended), or
- keep it but ensure Prisma is configured with `schemas = [...]` and can still access them (verify in a staging DB).

---

## 7) How this affects services

**Database gateway**
- No change to routes (`/v1/:entity`) or model names.
- Only the underlying table namespace changes.

**Feature services (lido-service / lending-service)**
- If they use the gateway: unaffected (still HTTP calls).
- If they use raw SQL: any direct `FROM "LidoPosition"` must become `FROM staking."LidoPosition"` (or use search_path).

**Frontend**
- Unaffected directly; it consumes feature-service APIs, not DB.
