# Telegram Gateway VM Step 1 Operations Guide

## Purpose

This guide documents the first migration step for moving Telegram gateway traffic from Azure Container Apps to a dedicated Azure VM, while keeping the current backend VM unchanged.

## Deployment Model

- Terraform runs in the existing root/state and creates additive resources only for the Telegram gateway VM path.
- GitHub Actions builds and pushes the `telegram-gateway` image to GHCR.
- GitHub Actions reads runtime values from Azure Key Vault and renders `.env.production`.
- GitHub Actions uploads the deployment bundle to the Telegram gateway VM and runs Docker Compose there.
- Caddy terminates TLS on the VM and proxies to the local gateway container.

## Required Azure Resources

Step 1 creates:

- one static public IP for the Telegram gateway VM
- one NIC
- one Linux VM

Step 1 reuses:

- the existing resource group
- the existing app subnet and NSG
- the existing Key Vault

## Required Secrets

The Telegram VM deployment expects these secrets in Key Vault:

- `public-gateway-url`
- `public-webapp-url`
- `website-url`
- `auth-api-base`
- `agents-api-base`
- `telegram-bot-token`
- `telegram-webhook-secret`
- `default-wallet-address`
- `letsencrypt-email`

GitHub Actions still uses GHCR credentials and the VM SSH key from GitHub secrets.

## Cutover Sequence

1. Apply Terraform with `telegram_gateway_vm_enabled=true`.
2. Wait for the new VM public IP to be allocated.
3. Run the Telegram deploy workflow to install the gateway image and Caddy config on the VM.
4. Create the DNS `A` record for the dedicated gateway subdomain.
5. Validate:
   - `https://<gateway-domain>/healthz`
   - `https://<gateway-domain>/telegram/webhook`
   - `/start` opens the current MiniApp URL
   - `POST /auth/telegram/verify` reaches the current backend auth API
6. Update the Telegram webhook to the new gateway subdomain.
7. Keep the Azure Container App available as rollback until the VM has been stable for an agreed soak period.

## Rollback

Rollback does not require Terraform changes.

1. Point the Telegram webhook back to the existing Azure Container App endpoint.
2. Confirm bot traffic resumes there.
3. Leave the new VM running for investigation, or stop the container if needed.

## Safety Checks

- `terraform plan` must show only additive resources for the Telegram VM path
- the existing backend VM must show no drift or recreation
- the app subnet and PostgreSQL resources must remain untouched
- the deployment bundle must not include Redis or MiniApp runtime for step 1
