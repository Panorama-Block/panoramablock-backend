# Deployment Runbook: Public APIs on ACA

Date: 2026-05-04

## Scope

This runbook covers the target deployment flow:

- Terraform-managed Azure infrastructure
- public APIs on Azure Container Apps
- heavy/internal workloads on the Azure VM Docker Compose path
- Key Vault as the runtime secret source
- GHCR as the image registry

## Prerequisites

- Azure CLI authenticated to the target subscription.
- Terraform `>= 1.6.0`.
- GitHub Actions OIDC configured with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`.
- GitHub and Key Vault secrets for GHCR, PostgreSQL, JWTs, RPC keys, wallet/private keys, and service URLs.
- PostgreSQL public network access enabled with restricted firewall rules for ACA reachability.
- VM SSH deployment path available for heavy/internal workloads.

## 1. Validate Infrastructure Configuration

From the repository root:

```bash
terraform -chdir=panorama-block-backend/cloud/iac/terraform init
terraform -chdir=panorama-block-backend/cloud/iac/terraform validate
terraform -chdir=panorama-block-backend/cloud/iac/terraform plan
```

Review the plan for:

- `public_api_container_apps_enabled = true`
- ACA environment, Log Analytics workspace, user-assigned identity, and five public API Container Apps
- PostgreSQL public network access and firewall rules matching the approved ACA access model
- no unintended VM, VNet, PostgreSQL, or Key Vault recreation
- no accidental assumption that ACA can reach the VM private IP; current Terraform does not provide ACA VNet integration

## 2. Apply Terraform

Apply only after the plan is reviewed:

```bash
terraform -chdir=panorama-block-backend/cloud/iac/terraform apply
```

Record outputs:

```bash
terraform -chdir=panorama-block-backend/cloud/iac/terraform output
```

Important outputs:

- `key_vault_name`
- `postgres_fqdn`
- `public_api_container_app_urls`
- `vm_public_ip_address`
- `vm_private_ip_address`

## 3. Verify Key Vault Secrets

Check that the required ACA secrets exist. Terraform currently expects the logical secret list in `local.public_api_required_secret_names`.

Example checks:

```bash
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name ghcr-password --query id -o tsv
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name database-url --query id -o tsv
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name jwt-secret --query id -o tsv
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name thirdweb-client-id --query id -o tsv
```

If an existing secret has a different name, map it through `public_api_key_vault_secret_name_overrides` before applying Terraform.

## 4. Build and Publish Images

For public API images, ensure GHCR contains the expected tag:

- `ghcr.io/<namespace>/auth-service:<tag>`
- `ghcr.io/<namespace>/bridge-service:<tag>`
- `ghcr.io/<namespace>/liquid-swap:<tag>`
- `ghcr.io/<namespace>/lido-service:<tag>`
- `ghcr.io/<namespace>/lending-service:<tag>`

The Terraform ACA path uses `public_api_image_tag`. Avoid `latest` for production rollouts unless rollback risk is explicitly accepted.

## 5. Deploy Public APIs to ACA

The Terraform module creates the Container Apps and points them at the configured GHCR images. For a new image tag:

1. Push all required images to GHCR.
2. Set `public_api_image_tag` to the immutable tag.
3. Run `terraform plan`.
4. Confirm only ACA image revisions or expected ACA resources change.
5. Run `terraform apply`.

Smoke test each URL from `public_api_container_app_urls`:

```bash
curl -fsS "https://<auth-aca-url>/health"
curl -fsS "https://<bridge-aca-url>/health"
curl -fsS "https://<liquid-swap-aca-url>/health"
curl -fsS "https://<lido-aca-url>/health"
curl -fsS "https://<lending-aca-url>/health"
```

Also validate one real request per service, because `/health` may not exercise PostgreSQL, Redis, RPC providers, or cross-service dependencies.

If a public API requires VM backhaul, validate the chosen network path before cutover. Do not assume `http://<heavy-vm-private-ip>:8081` is reachable from ACA unless the ACA environment has been integrated with the VNet or an explicitly secured public/private ingress path has been added.

## 6. Deploy Heavy/Internal VM Workloads

Use `.github/workflows/deploy-vm-backend.yml`.

This workflow:

- builds `dca-service`, `diagram-service`, and `database-gateway`
- resolves the `execution-service` image
- renders `.env.production` from Key Vault
- uploads `deploy/azure-vm/docker-compose.heavy.yml`, Caddy config, scripts, and shared token registry
- bootstraps PostgreSQL databases
- runs database gateway migrations
- restarts selected Docker Compose services on the VM

Validate VM backhaul:

```bash
curl -fsS "http://<heavy-vm-private-ip>:8081/"
curl -fsS "http://<heavy-vm-private-ip>:8081/database/health"
curl -fsS "http://<heavy-vm-private-ip>:8081/engine/health"
curl -fsS "http://<heavy-vm-private-ip>:8081/execution/health"
```

Run these from a network path that can reach the private VM IP.

## 7. Cutover

For ACA cutover:

1. Keep the VM public/API path available during stabilization.
2. Point DNS or API gateway routing to the ACA endpoints.
3. Validate public health endpoints.
4. Validate authenticated flows and provider-backed flows.
5. Watch ACA logs and PostgreSQL connection metrics.

Useful checks:

```bash
az containerapp logs show --name "<app-name>" --resource-group "$RG" --follow
az postgres flexible-server show --resource-group "$RG" --name "$POSTGRES_SERVER"
```

## 8. Rollback

Preferred rollback order:

1. Revert DNS/API routing to the previous VM public/API endpoint if it is still healthy.
2. If only one ACA service failed, set `public_api_image_tag` back to the previous known-good image tag and apply Terraform.
3. If a secret caused the failure, restore the previous Key Vault secret version and restart the affected ACA revision.
4. If PostgreSQL firewall rules caused the failure, restore the last known-good restricted firewall configuration.

Do not destroy ACA resources during rollback unless they are causing active production impact; keep logs available for diagnosis.

## Documentation Caveats

- This runbook documents the Terraform ACA path. Legacy `az containerapp update` workflows exist and should not be mixed into the same rollout unless drift is understood.
- `deploy-public-api-vm.yml` is still useful as a VM fallback path, but it is not the target ACA deployment mechanism.
- Terraform validation is necessary but not sufficient; smoke tests are required.
- ACA-to-VM backhaul is a known implementation gap unless a reachable and secured path is added.
