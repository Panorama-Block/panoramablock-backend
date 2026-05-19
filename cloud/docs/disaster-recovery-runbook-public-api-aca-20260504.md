# Disaster Recovery Runbook: Public APIs on ACA

Date: 2026-05-04

## Recovery Targets

This is a startup best-effort DR plan, not a strict production compliance plan.

Target expectations:

- RTO: restore core public API availability within hours when Azure region and PostgreSQL are available.
- RPO: bounded by Azure PostgreSQL backup retention and the last successful transaction before an incident.
- Priority: protect PostgreSQL data first, then restore public API availability, then restore heavy/internal workers.

## Scenario 1: Bad ACA Deploy or Unhealthy Revision

Symptoms:

- one or more ACA `/health` endpoints fail
- new revision logs show startup, secret, image pull, or database errors
- traffic succeeds on old VM path but fails on ACA

Recovery:

1. Confirm the failing app and revision:

   ```bash
   az containerapp revision list --name "<app-name>" --resource-group "$RG" -o table
   az containerapp logs show --name "<app-name>" --resource-group "$RG" --follow
   ```

2. Revert `public_api_image_tag` to the previous known-good immutable tag.
3. Run `terraform plan` and confirm only expected ACA image changes.
4. Run `terraform apply`.
5. Smoke test `/health` and one real request for the affected service.
6. If DNS/API routing was already cut over and the rollback is not immediate, route traffic back to the VM endpoint.

Where this can be wrong:

- ACA module uses `revision_mode = "Single"`, so rollback depends on redeploying a previous image tag rather than shifting traffic between active revisions.

## Scenario 2: VM Failure or Lost Docker Host

Symptoms:

- internal backhaul on `8081` fails
- `database-gateway`, `execution-service`, `engine`, `dca`, or `diagram-service` unavailable
- public APIs that depend on heavy services return errors
- ACA public APIs cannot reach private VM backhaul after cutover

Recovery:

1. Check VM status:

   ```bash
   az vm get-instance-view --resource-group "$RG" --name "<vm-name>" --query instanceView.statuses -o table
   ```

2. If the VM is stopped, start it:

   ```bash
   az vm start --resource-group "$RG" --name "<vm-name>"
   ```

3. If the VM is unrecoverable, recreate infrastructure from Terraform without changing PostgreSQL.
4. Re-run `.github/workflows/deploy-vm-backend.yml`.
5. Confirm Caddy and Docker Compose:

   ```bash
   docker compose --env-file /opt/panorama/current/.env.production -f /opt/panorama/current/docker-compose.yml ps
   systemctl status caddy
   ```

6. Smoke test backhaul paths from inside the VNet.

Where this can be wrong:

- If local Redis contained non-disposable state, VM loss may cause data loss. The documented assumption is that Redis is cache/compatibility only.
- If ACA was never given a reachable path to VM backhaul, this is not a DR incident; it is an incomplete architecture implementation.

## Scenario 3: PostgreSQL Outage or Data Loss

Symptoms:

- services fail database connections
- migrations fail
- accidental delete or corrupt data is detected

Recovery:

1. Confirm server state:

   ```bash
   az postgres flexible-server show --resource-group "$RG" --name "$POSTGRES_SERVER"
   ```

2. For transient outage, wait for Azure recovery and avoid destructive migrations.
3. For accidental data loss, perform point-in-time restore to a new PostgreSQL Flexible Server.
4. Validate restored data before repointing services.
5. Update Key Vault `database-url` and VM PostgreSQL host/app credentials if needed.
6. Restart ACA services and redeploy/restart VM workloads.

Where this can be wrong:

- Current backup retention defaults to 7 days. Any recovery point outside retention is unavailable.
- Public DB firewall rules may block restored server access until recreated.

## Scenario 4: Key Vault Secret Loss or Rotation Failure

Symptoms:

- Terraform fails reading `data.azurerm_key_vault_secret.public_api`
- ACA cannot start because a secret reference is missing
- VM deploy workflow fails during `.env.production` rendering

Recovery:

1. Identify missing or bad secret:

   ```bash
   az keyvault secret list --vault-name "$KEY_VAULT_NAME" -o table
   az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "<secret-name>"
   ```

2. Restore a previous secret version when possible.
3. If restoring is not possible, recreate the secret from the operational secret source of truth.
4. Re-run Terraform for ACA secret references if needed.
5. Restart or redeploy affected ACA and VM services.

Where this can be wrong:

- The repo does not document an external escrow/source-of-truth for every secret. If Key Vault is the only copy and purge/retention windows are exceeded, recovery may be impossible.

## Scenario 5: GHCR or Image Rollback Failure

Symptoms:

- ACA image pull errors
- VM deploy fails at `docker pull`
- previous image tag is missing

Recovery:

1. Confirm the image exists in GHCR.
2. If the previous tag exists, redeploy that tag.
3. If the tag is missing, rebuild from the corresponding git SHA and push the expected image.
4. Re-run Terraform for ACA or the VM deploy workflow.

Where this can be wrong:

- Production rollback is weak if deployments use mutable `latest` instead of immutable commit tags.

## Scenario 6: Public PostgreSQL Firewall Misconfiguration

Symptoms:

- ACA services fail database connections while images and secrets are valid
- VM private database access may still work

Recovery:

1. Identify current firewall rules:

   ```bash
   az postgres flexible-server firewall-rule list --resource-group "$RG" --name "$POSTGRES_SERVER" -o table
   ```

2. Restore last known-good restricted rules.
3. Verify ACA service database connectivity with a real request, not only `/health`.
4. Review whether broad rules were temporarily opened and close them.

Where this can be wrong:

- ACA outbound IP behavior can change with infrastructure changes. Rules must be validated after ACA environment changes.

## Scenario 7: DNS or Endpoint Cutover Failure

Symptoms:

- direct ACA FQDN works, but custom domain fails
- clients still call the VM endpoint
- CORS or callback URLs point at the old host

Recovery:

1. Confirm DNS records and TTL.
2. Test direct ACA FQDN and custom domain separately.
3. Revert DNS/API gateway routing to the previous VM endpoint if public traffic is failing.
4. Verify Key Vault URL secrets such as auth domains, public gateway URLs, and app domains.

Where this can be wrong:

- Some services use URL values rendered from Key Vault or Terraform variables. DNS rollback alone may not fix flows if service-side configured domains are stale.

## Regular DR Checks

Run at least monthly during active development:

- `terraform validate`
- list and sample-read required Key Vault secrets
- confirm latest and previous image tags exist in GHCR
- run ACA health checks
- run VM backhaul health checks
- confirm PostgreSQL backup retention and restore capability
- review firewall rules for accidental broad access
