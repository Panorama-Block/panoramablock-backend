# ADR: Public API Services on Azure Container Apps

Date: 2026-05

## Status

Accepted as the current documentation target.

Implementation is still partly in transition. Terraform contains an optional ACA path gated by `public_api_container_apps_enabled`, and legacy Container App workflows still exist beside the newer Terraform module.

## Context

Panorama has three documented infrastructure directions in the repository:

- an older single-VM Docker Compose baseline
- a VM split with public/API services separated from heavier internal services
- a newer Azure Container Apps path for public API services

The current target is to run public API services on Azure Container Apps and keep heavier/internal workloads on a VM. This gives public endpoints independent scaling and deployment boundaries while keeping cost and operational load lower than a full managed-container migration.

PostgreSQL is the source of record. Key Vault is the canonical secret store. For the current target, ACA reaches PostgreSQL through public PostgreSQL network access restricted by firewall rules, not through private ACA VNet integration.

## Decision

Run these public API services on Azure Container Apps:

- `auth`
- `bridge`
- `liquid-swap`
- `lido`
- `lending`

Keep these heavy/internal services on the VM Docker Compose path:

- `dca`
- `diagram-service`
- `database-gateway`
- `execution-service`
- `thirdweb engine`
- Redis compatibility container

Use Azure PostgreSQL Flexible Server for durable data and Azure Key Vault for secrets. Use GHCR as the container image registry.

## Options Considered

| Option | Decision | Reason |
| --- | --- | --- |
| Single VM for all services | Rejected | Cheapest and simplest, but public APIs and heavy workers share one failure domain and deployment blast radius. |
| Two-VM only split | Rejected as target | Better isolation than one VM, but public APIs still depend on VM capacity and manual host operations. |
| ACA public APIs with private VNet-integrated PostgreSQL | Rejected for now | Stronger security posture, but requires ACA network integration work not currently represented in Terraform. |
| ACA public APIs with public PostgreSQL firewall rules | Accepted | Matches the chosen implementation direction and avoids blocking ACA on VNet integration, at the cost of weaker DB network isolation. |
| Full ACA migration | Rejected for now | More expensive and complex for always-on internal/heavy services; not justified by the current stage. |

## Consequences

Positive:

- Public APIs can scale independently from heavy/internal services.
- Public API deployment blast radius is smaller than the all-services VM.
- Key Vault and GHCR remain shared primitives across VM and ACA deployment paths.
- Existing VM path can remain available as rollback during migration.

Negative:

- Public PostgreSQL access increases security risk compared with private-only PostgreSQL.
- Terraform and GitHub workflow paths can drift because both ACA and VM deployment mechanisms exist.
- Cross-service URLs must be managed carefully because `bridge` depends on other public APIs and backhaul services.
- DR procedures now need to cover both Azure Container Apps and VM Docker Compose.

## Required Guardrails

- PostgreSQL firewall rules must be restricted to required Azure egress ranges or explicitly approved trusted ranges; `0.0.0.0/0` is not acceptable for production.
- All ACA secrets must come from Key Vault references, not inline values.
- Each ACA must keep `/health` liveness and readiness probes.
- VM-based heavy services must expose only the intended backhaul path, currently `8081/tcp` from the app subnet.
- Rollback must keep either previous ACA image tags or the VM public/API path available until smoke tests pass.

## Known Gaps

- Terraform validates, but that does not prove all Key Vault secrets exist or that ACA can reach PostgreSQL.
- `container_apps_workload_profile_name` exists as a variable but is not applied to the ACA environment.
- The current ACA environment is not VNet integrated.
- Some existing docs still describe single-VM or two-VM-only targets and are stale for this decision.
- Legacy `az containerapp update` workflows may diverge from Terraform-managed ACA configuration.
