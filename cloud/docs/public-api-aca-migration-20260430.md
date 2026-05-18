# Public API ACA Migration

Date: 2026-04-30

## Scope

Move the public production API services from the VM deployment path to Azure Container Apps:

- auth
- liquid-swap
- bridge
- lido / liquid-staking
- lending

The VM remains available during migration and cutover so traffic can be rolled back by DNS or gateway routing.

## Terraform Structure

- `cloud/iac/terraform/main.tf`
  - shared Container Apps Environment
  - Log Analytics workspace
  - user-assigned managed identity for Container Apps
  - Key Vault access policy for that identity
  - one module call per public API service
- `cloud/iac/terraform/modules/container_app`
  - reusable `azurerm_container_app`
  - public ingress
  - GHCR registry configuration
  - Key Vault-backed secrets
  - `/health` liveness and readiness probes
  - HTTP scale rule

The migration is gated by `public_api_container_apps_enabled`, which defaults to `false`.

## Naming

Production names follow:

- resource prefix: `<project_name>-<environment>`
- ACA environment: `<prefix>-public-api-aca-env`
- Log Analytics workspace: `<prefix>-aca-law`
- managed identity: `<prefix>-aca-mi`
- apps:
  - `<prefix>-auth-api`
  - `<prefix>-liquid-swap-api`
  - `<prefix>-bridge-api`
  - `<prefix>-lido-api`
  - `<prefix>-lending-api`

For production, set `environment = "prod"` and `resource_group_name` to the production resource group.

## Service Matrix

| Service | Image | Port | Public ingress | CPU | Memory | Min | Max | Health |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | --- |
| auth | `ghcr.io/<namespace>/auth-service:<tag>` | 3001 | yes | 0.5 | 1Gi | 1 | 10 | `/health` |
| liquid-swap | `ghcr.io/<namespace>/liquid-swap:<tag>` | 3002 | yes | 0.5 | 1Gi | 1 | 5 | `/health` |
| bridge | `ghcr.io/<namespace>/bridge-service:<tag>` | 3005 | yes | 0.5 | 1Gi | 1 | 5 | `/health` |
| lido | `ghcr.io/<namespace>/lido-service:<tag>` | 3004 | yes | 0.5 | 1Gi | 1 | 5 | `/health` |
| lending | `ghcr.io/<namespace>/lending-service:<tag>` | 3001 | yes | 0.5 | 1Gi | 1 | 5 | `/health` |

## Secrets

Container Apps uses a user-assigned managed identity to read Key Vault secrets. Terraform creates Container Apps secret references, not inline secret values, for app credentials and registry password.

Required logical secret names are defined in `local.public_api_required_secret_names`. Use `public_api_key_vault_secret_name_overrides` when existing Key Vault names differ.

## Registry

Images are pulled from GHCR:

- server: `container_registry_server`
- namespace: `container_registry_namespace`
- tag: `public_api_image_tag`
- username: `container_registry_username`
- password: Key Vault secret logical name `ghcr-password`

## Risks

- Current target decision: PostgreSQL access from ACA uses public PostgreSQL network access with restricted firewall rules. This is weaker than private-only PostgreSQL and must be reviewed before production.
- If any ACA service requires VM backhaul, the current Terraform does not provide private ACA-to-VM reachability. Add VNet integration or another secured network path before cutover.
- Existing image names and tags must match the GHCR publish workflow before enabling production deploys.
- Bridge service dependencies should be verified after all ACA URLs are known.
- Public ingress moves direct exposure from Caddy/VM to ACA FQDNs; DNS and CORS need smoke testing before cutover.

## Current Documentation Set

- `adr-public-api-container-apps-20260504.md`
- `architecture-overview-public-api-aca-20260504.md`
- `deployment-runbook-public-api-aca-20260504.md`
- `disaster-recovery-runbook-public-api-aca-20260504.md`
- `missing-documentation-and-risk-register-20260504.md`

## Rollback

1. Keep the VM stack running during stabilization.
2. Cut traffic by changing DNS/API routing from the VM endpoint to ACA endpoints.
3. If smoke tests fail, revert DNS/API routing to the VM endpoint.
4. Keep ACA resources deployed for log inspection unless they are causing production impact.
