# Security Design

## Objectives

- Public exposure limited to `80/443`
- No direct public exposure of application containers
- PostgreSQL reachable only over private networking
- Secrets stored centrally in Key Vault
- Reasonable startup-grade security without expensive enterprise add-ons

## Controls

### Network

- NSG allows inbound `80/tcp` and `443/tcp` only.
- All other inbound traffic is denied by default.
- Application containers bind only to `127.0.0.1` on the VM host.
- PostgreSQL Flexible Server uses a delegated subnet and private DNS, with public network access disabled.

### Compute

- Ubuntu LTS image with password authentication disabled.
- Docker runs only on the VM; no Docker API is exposed remotely.
- VM uses a system-assigned managed identity.
- Caddy terminates TLS on the host and forwards to services over local HTTP.

### Secrets

- Key Vault stores application secrets, database admin password, and deploy-time credentials.
- GitHub Actions authenticates to Azure via OIDC rather than a long-lived Azure client secret.
- VM managed identity gets `Get/List` on secrets for optional future runtime fetching.
- Simpler recommended runtime pattern: fetch secrets during deployment, render `.env.production`, transfer it to the VM, and restart the stack.

## Direct SSH Tension

The user requirement asks for an SSH-based deployment step, but the network requirement also says to expose only `80/443`. Those two constraints conflict if SSH is done directly over the public internet.

Recommended handling:

- Keep the public NSG at `80/443` only.
- Use Azure control-plane deployment (`az vm run-command invoke`) or a private management path for deployments.

The included pipeline still shows an SSH-based variant because it was explicitly requested. Treat that as valid only when one of the following is true:

- SSH happens through a private path such as VPN, Bastion, or a self-hosted runner inside the VNet.
- A temporary and tightly scoped `22/tcp` rule from a fixed trusted CIDR is accepted operationally.

## Minimum Hardening Checklist

- Enable automatic security updates on the VM.
- Rotate Key Vault secrets instead of editing env files manually.
- Store only the deployment SSH key in GitHub secrets; do not store application secrets there long term.
- Use separate Key Vaults or resource groups per environment later if production is added.
- Turn on PostgreSQL SSL enforcement and connect with `sslmode=require`.
