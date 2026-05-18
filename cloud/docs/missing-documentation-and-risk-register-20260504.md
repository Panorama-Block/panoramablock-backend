# Missing Documentation and Risk Register

Date: 2026-05-04

## Purpose

This register captures places where Panorama cloud documentation may be incomplete, stale, or wrong. It is intentionally critical.

## Risks and Gaps

| Area | Risk | Impact | Required follow-up |
| --- | --- | --- | --- |
| Architecture target | Existing docs describe single VM, two-VM, and ACA targets. | Operators may deploy the wrong path or mix rollback instructions. | Mark older docs as historical or update them to point to the ACA target docs. |
| Terraform state | ACA files are currently uncommitted/untracked in the working tree. | Documentation may describe infrastructure not yet merged or applied. | Commit/review ACA Terraform before treating it as production source of truth. |
| ACA database access | Target uses public PostgreSQL access with firewall rules. | Weaker than private-only database posture; firewall mistakes can expose the DB. | Document approved source ranges and review rules before production. |
| Network validation | `terraform validate` passes but does not prove runtime connectivity. | ACA services can deploy but fail database-backed requests. | Add smoke tests that perform real DB-backed operations. |
| Secrets | Required ACA secrets are defined in Terraform locals but not documented as a full checklist elsewhere. | Missing Key Vault secrets fail Terraform apply or app startup. | Maintain a required-secret inventory with owner and rotation notes. |
| Deployment paths | Legacy `az containerapp update` workflows coexist with Terraform-managed ACA. | Drift between Terraform and manually updated Container Apps. | Pick one ACA deploy mechanism for production and mark the other deprecated. |
| SSH exposure | Terraform NSG allows `22/tcp` from `*`. | Public SSH exposure conflicts with the security design. | Restrict SSH to trusted CIDRs, Bastion, VPN, or self-hosted runner path. |
| ACA-to-VM backhaul | Current ACA environment is not VNet-integrated while VM backhaul is private/app-subnet oriented. | Public APIs that require heavy VM services may fail after ACA cutover. | Add VNet integration or another secured reachability design before relying on backhaul from ACA. |
| Unused variable | `container_apps_workload_profile_name` is declared but not used. | Operators may think workload profile behavior is configurable when it is not. | Either wire the variable or remove it from docs/config. |
| Naming | Outputs named `public_api_vm_*` reuse `telegram_gateway` resources. | Operators can misidentify the public API VM and Telegram gateway path. | Rename outputs/resources in a future IaC cleanup or document aliasing clearly. |
| Rollback | ACA module uses single revision mode. | Rollback is image-tag redeploy, not traffic shifting to an old revision. | Keep immutable image tags and document last-known-good tag per release. |
| Redis | Redis is described as disposable, but services still depend on it. | If Redis contains meaningful state, VM loss can cause data loss. | Verify Redis usage and document whether any queues/sessions are durable. |
| PostgreSQL restore | Backup retention defaults to 7 days. | Older data corruption may be unrecoverable. | Decide retention and test point-in-time restore. |
| Observability | ACA has Log Analytics, but VM logging is mostly Docker/Caddy local logs. | Incident diagnosis may be slow after host failure. | Add centralized VM logs if uptime expectations increase. |
| DNS and domains | Some domains are configured in Key Vault, DNS, and service env. | Cutover/rollback can leave inconsistent callback or CORS behavior. | Document every public hostname, owning secret, DNS record, and service dependency. |

## Assumptions Being Made

- Public APIs will move to ACA as the current target.
- VM public/API deployment remains available as a rollback path during migration.
- PostgreSQL is the only durable application data store.
- Redis can be rebuilt without permanent data loss.
- GHCR image tags are available for current and previous releases.
- Key Vault secret values can be restored or recreated from an operational source.

## Where Documentation Could Be Wrong

- Terraform may change before these docs are implemented in production.
- Existing Azure resources may have been created manually and differ from Terraform.
- ACA outbound IP ranges may not match the PostgreSQL firewall assumptions.
- Some services may require hidden environment variables not captured in Terraform locals.
- Health endpoints may return success while deeper provider, database, or cross-service calls fail.
- Legacy workflow files may still be used by operators even after Terraform becomes the intended ACA deployment path.
