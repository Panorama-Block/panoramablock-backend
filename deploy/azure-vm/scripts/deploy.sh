#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/panorama}"
RELEASE_DIR="${APP_DIR}/current"
COMPOSE_FILE="${RELEASE_DIR}/docker-compose.yml"
ENV_FILE="${RELEASE_DIR}/.env.production"
CADDY_SOURCE="${RELEASE_DIR}/Caddyfile"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "docker-compose.yml not found in ${RELEASE_DIR}"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo ".env.production not found in ${RELEASE_DIR}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_PASSWORD:-}" ]]; then
  echo "${GHCR_PASSWORD}" | docker login "${GHCR_REGISTRY:-ghcr.io}" -u "${GHCR_USERNAME}" --password-stdin
fi

if [[ -f "${CADDY_SOURCE}" ]]; then
  sudo install -m 0644 "${CADDY_SOURCE}" /etc/caddy/Caddyfile
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans
docker image prune -af --filter "until=168h" || true
