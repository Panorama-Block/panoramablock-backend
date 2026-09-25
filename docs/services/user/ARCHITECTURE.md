# PanoramaBlock User Service Architecture

Status: implementation in progress
Scope: canonical PanoramaBlock user identity resolution

## Purpose

The User Service introduces a single resolution boundary between an authenticated external identity and an existing PanoramaBlock business user.

Authentication answers: Which external identity has successfully authenticated?

User resolution answers: Which existing PanoramaBlock `User.userId` does that authenticated identity belong to?

These are separate concerns.

The User Service does not authenticate Thirdweb, Telegram, TON, or other providers. Authentication remains the responsibility of the relevant authentication boundary.

## Identity model

The intended resolution path is:

    authenticated external identity
                 |
                 v
            User Service
                 |
                 v
            UserIdentity
                 |
                 v
          existing User.userId

`User.userId` remains the existing PanoramaBlock business identifier during construction and consumer migration.

The introduction of the User Service does not change existing `User.userId` values.

## Current provider namespaces

The initial User Service domain recognises these authentication namespaces:

| Provider | Subject |
| --- | --- |
| `thirdweb-evm` | EVM address successfully authenticated through the current PanoramaBlock Thirdweb/EVM authentication path |
| `telegram` | Telegram-native user ID established from the Telegram authentication context |
| `ton` | Authenticated TON address |

Provider subjects are namespace-specific.

No equality between identifiers from different namespaces may be inferred merely because they refer to the same person.

In particular, `thirdweb-evm` does not mean Thirdweb canonical account `userId`. It describes the authenticated EVM-address identity used by the current PanoramaBlock authentication path.

## UserIdentity

`UserIdentity` is additive persistence for verified external-identity mappings.

Its core relationship is:

    (tenantId, provider, providerSubject) -> User.userId

Within a tenant, one provider subject may resolve to at most one PanoramaBlock user.

A PanoramaBlock user may have multiple identities, including identities in multiple provider namespaces.

The database enforces uniqueness of `(tenantId, provider, providerSubject)`.

`UserIdentity.userId` has a foreign-key relationship to the existing `User.userId`.

Deletion of a referenced user is restricted rather than cascading identity records.

## Verification and provenance

A `UserIdentity` row represents an identity relationship PanoramaBlock has established. `verifiedAt` is therefore required.

`provenance` records evidence or migration context associated with the relationship. It does not replace authentication or verification.

Ordinary Database Gateway updates cannot modify:

- `userId`
- `provider`
- `providerSubject`
- `tenantId`

Relinking an identity is an identity-governance operation and must not be implemented as generic CRUD.

## Resolution semantics

Resolution is fail-closed:

    0 mappings -> unresolved
    1 mapping  -> resolved
    >1 mapping -> integrity_error

The service must never choose arbitrarily between multiple mappings.

Repository lookups use a bounded result set sufficient to distinguish these states.

## Tenant isolation

Identity resolution is tenant-scoped.

The Database Gateway remains responsible for enforcing its normal tenant boundary. User Service supplies the authenticated/request tenant context and must also validate returned identity records before treating them as resolved.

## Database Gateway repository

The User Service resolves persisted identities through the existing PanoramaBlock Database Gateway rather than connecting directly to PostgreSQL.

The implemented repository contract performs a tenant-scoped read of `user-identities` using:

    GET /v1/user-identities
        where = { provider, providerSubject }
        take = 2

Tenant identity is supplied through the Database Gateway `x-tenant-id` request context rather than duplicated into the caller-provided `where` clause. The Gateway remains responsible for enforcing its tenant boundary.

`take=2` is intentional. The resolver only needs enough records to distinguish:

    0 mappings -> unresolved
    1 mapping  -> resolved
    >=2 mappings -> integrity_error

The repository treats transport failures, timeouts, non-success HTTP responses, malformed JSON, malformed response envelopes, and invalid or mismatched identity records as errors. These conditions must not be converted into an unresolved identity.

Returned mappings are checked against the requested tenant, provider and provider subject before they cross the repository boundary.

The repository is read-only at this stage. It does not create, link, relink or delete identities.

This adapter is implemented and locally tested, but its presence does not mean the User Service is deployed or that any production consumer has been cut over to it.

## Relationship to wallets and profiles

The following concepts remain distinct:

    User
        PanoramaBlock business identity

    UserIdentity
        verified external authentication identity -> User mapping

    Wallet
        cryptographic account associated with a User

    UserProfile
        existing PanoramaBlock profile data

An address may currently have the same string value as `User.userId`, `User.walletAddress`, and `Wallet.address`. Equality of values does not make these concepts semantically interchangeable.

## Existing legacy mechanisms

The existing estate contains partial identity mechanisms, including:

- current EVM authentication persistence that ensures PB User, UserProfile and Wallet records;
- Redis `telegram_link:*` mappings;
- service-specific Telegram/wallet links;
- bridge-service local user/wallet identity data;
- client and gateway fallbacks that may use wallet addresses, TON addresses or Telegram IDs as `userId`.

These mechanisms are not declared canonical by the introduction of `UserIdentity`.

They remain unchanged until their individual migration gates are reached.

## Current rollout state

At the initial persistence stage:

- `UserIdentity` is additive infrastructure;
- no identity backfill has been performed;
- no existing consumer depends on User Service;
- no existing authentication path has been cut over;
- no existing `User`, `Wallet`, or `UserProfile` identifier has been changed;
- existing production behaviour remains authoritative.

The User Service must first be built and validated in isolation.

Consumer migration will then occur incrementally, with shadow, read and authoritative stages where appropriate.

## Canonicalisation hard gate

Physical canonicalisation of the existing PB User database is explicitly outside the initial User Service migration.

No repair or replacement of historical `User.userId` values is permitted until:

1. every identity entry point uses User Service;
2. no consumer derives PB identity directly from wallet address;
3. no consumer derives PB identity directly from Telegram ID;
4. no consumer independently maps provider identity to PB User;
5. legacy paths have been exercised and verified;
6. cutover and rollback evidence has been retained.

Only after that consumer audit passes may the final user-database canonicalisation question be assessed.

Physical replacement of `User.userId` is not assumed to be necessary. The decision must be based on evidence available after migration.
