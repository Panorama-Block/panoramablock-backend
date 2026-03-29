# Operations Guide

## Deployment Model

- Infrastructure is created with Terraform.
- Application images are built in GitHub Actions and pushed to GHCR.
- Runtime secrets are pulled from Key Vault at deploy time.
- The VM receives a versioned deployment bundle and executes `docker compose up -d`.

## Secrets Injection Strategy

### Recommended initial approach

Use **deploy-time `.env.production` rendering**:

1. Store canonical secrets in Key Vault.
2. GitHub Actions reads them via `az keyvault secret show`.
3. The workflow renders `.env.production`.
4. The file is uploaded to the VM and used by Docker Compose.

Why this is recommended first:

- simple
- predictable
- no custom startup code inside each service
- easy to audit and rotate

### Future approach

Move selected services to dynamic Key Vault reads through the VM managed identity if secret rotation frequency or compliance pressure increases.

## Backup

- PostgreSQL uses managed backups with 7-day retention.
- Application state should stay out of the VM wherever possible.
- If optional Redis is enabled, treat it as disposable cache, not a source of record.

## Logging

- Use `docker compose logs` and Docker JSON logs initially.
- Rotate logs on the VM to avoid disk exhaustion.
- Add Azure Monitor Agent later only if you need centralized log search.

## Recovery

- Recreate infra from Terraform state.
- Re-provision the VM with cloud-init.
- Re-run the GitHub Actions deployment to restore services.
- Database remains available because it is managed separately from the VM.
