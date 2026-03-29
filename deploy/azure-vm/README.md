# Azure VM Deployment Bundle

This directory contains the runtime bundle for the low-cost Azure VM target:

- `docker-compose.yml`: all services on one VM
- `Caddyfile`: HTTPS termination and path routing
- `.env.production.example`: runtime variable template
- `scripts/deploy.sh`: pulls images and restarts the stack
- `scripts/init-managed-postgres.sh`: creates app databases if missing

## Notes

- Containers bind only to `127.0.0.1`, so they are not publicly exposed.
- Caddy listens on `80/443` and proxies to the localhost ports.
- `redis` is under the `compat-redis` profile and should be enabled only if a service still needs it.
