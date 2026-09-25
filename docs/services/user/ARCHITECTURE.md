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

## Internal resolution HTTP boundary

The User Service exposes the resolution operation as:

    POST /v1/identity/resolve

The request requires:

    x-tenant-id: <tenant>

with a JSON body supplying the identity coordinates used for resolution:

    {
      "provider": "thirdweb-evm" | "telegram" | "ton",
      "subject": "<authenticated provider subject>"
    }

Only `provider` and `subject` participate in identity resolution. Additional request-body fields are ignored rather than treated as identity assertions.

The tenant is taken from the request header. A tenant supplied in the request body does not participate in resolution.

Likewise, caller-supplied `userId`, wallet-address or other identity assertions do not participate in resolution. The caller supplies an already-authenticated provider identity; the User Service determines the corresponding PanoramaBlock user from persisted identity mappings.

The HTTP result contract is:

    200 -> resolved
    404 -> unresolved
    409 -> integrity_error
    400 -> invalid request
    503 -> resolution infrastructure unavailable

An unresolved identity is therefore distinct from an infrastructure failure. Database Gateway configuration errors, transport failures and repository failures must fail closed as service-unavailable conditions rather than being reported as an absent identity.

Malformed JSON is returned through the bounded JSON `400 invalid_request` contract rather than the default Express HTML error response.

Runtime composition is:

    HTTP application
          |
          v
    IdentityResolver
          |
          v
    DatabaseGatewayIdentityRepository
          |
          v
    Database Gateway

The health endpoint remains independent of Database Gateway availability. This permits process health to be observed without converting downstream resolution availability into process startup state.

### Authentication boundary status

The resolution endpoint does not authenticate Thirdweb, Telegram or TON credentials. Those credentials must already have been authenticated by the appropriate provider-specific authentication boundary before their identity coordinates are supplied for resolution.

This stage also does not introduce or claim inbound service-to-service authentication for the User Service HTTP boundary.

Service-to-service authentication remediation is tracked separately as CP-20 and is deliberately deferred. A6 does not duplicate or partially reimplement that security work.

Consequently, successful local implementation of this endpoint does not by itself make it suitable for unrestricted production exposure.

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

At the current isolated implementation stage:

- `UserIdentity` is additive infrastructure;
- the read-only Database Gateway repository adapter is implemented and locally tested;
- the internal resolution HTTP boundary is implemented and locally tested;
- the runtime application composes the HTTP boundary, `IdentityResolver` and Database Gateway repository;
- no identity backfill has been performed;
- the additive `UserIdentity` migration has not been applied to production;
- no existing consumer depends on User Service;
- no existing authentication path has been cut over;
- the User Service has not been deployed as part of this stage;
- no existing `User`, `Wallet`, or `UserProfile` identifier has been changed;
- existing production behaviour remains authoritative.

The User Service is being built and validated in isolation before consumer migration.

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
