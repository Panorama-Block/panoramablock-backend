# Migration Roadmap

## Phase 1

- Provision the new VM-based Azure environment.
- Move secrets into Key Vault.
- Deploy the Compose stack to the VM.
- Keep optional local Redis enabled only for services that still require it.

## Phase 2

- Remove Redis dependencies from DCA, auth, and engine-adjacent flows where possible.
- Move queue/state use cases to PostgreSQL tables or service-local memory.
- Add lightweight monitoring and alerts.

## Phase 3

- Split high-churn or high-load services first if independent scaling becomes necessary.
- Candidate extractions: `execution-service`, `liquid-swap-service`, or `dca-service`.

## Future Evolution

### Back to Azure Container Apps

Move back to Container Apps when:

- you need per-service scaling
- independent deployments are frequent
- uptime expectations are higher than a single VM can reasonably support

Preparation already done by this design:

- services remain containerized
- reverse proxy routes are explicit
- secrets already live in Key Vault
- CI already builds and publishes images

### To Kubernetes

Move to AKS only when:

- there is sustained traffic
- multiple teams need stronger service isolation
- platform engineering overhead is acceptable

The migration path is straightforward because Compose service definitions map cleanly to Deployments, Services, and Ingress objects.
