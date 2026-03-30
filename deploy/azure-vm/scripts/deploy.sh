#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/panorama}"
RELEASE_DIR="${APP_DIR}/current"
COMPOSE_FILE="${RELEASE_DIR}/docker-compose.yml"
ENV_FILE="${RELEASE_DIR}/.env.production"
CADDY_SOURCE="${RELEASE_DIR}/Caddyfile"
CADDY_RENDERED=""

require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "required file not found: ${path}" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "required environment variable is missing: ${name}" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${CADDY_RENDERED}" && -f "${CADDY_RENDERED}" ]]; then
    rm -f "${CADDY_RENDERED}"
  fi
}

render_caddyfile() {
  local template_path="$1"
  local output_path="$2"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$template_path" "$output_path" <<'PY'
import os
import re
import sys

template_path, output_path = sys.argv[1], sys.argv[2]
pattern = re.compile(r"\{\$([A-Z0-9_]+)\}")

with open(template_path, "r", encoding="utf-8") as f:
    content = f.read()

def replace(match):
    name = match.group(1)
    value = os.environ.get(name)
    if value is None:
        raise SystemExit(f"missing template variable: {name}")
    return value

rendered = pattern.sub(replace, content)

with open(output_path, "w", encoding="utf-8") as f:
    f.write(rendered)
PY
    return
  fi

  echo "python3 is required to render the Caddy config template" >&2
  exit 1
}

trap cleanup EXIT

require_file "${COMPOSE_FILE}"
require_file "${ENV_FILE}"
require_file "${CADDY_SOURCE}"

set -a
source "${ENV_FILE}"
set +a

require_env "APP_DOMAIN"
require_env "LETSENCRYPT_EMAIL"

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_PASSWORD:-}" ]]; then
  echo "${GHCR_PASSWORD}" | docker login "${GHCR_REGISTRY:-ghcr.io}" -u "${GHCR_USERNAME}" --password-stdin
fi

if [[ -f "${CADDY_SOURCE}" ]]; then
  CADDY_RENDERED="$(mktemp "${RELEASE_DIR}/Caddyfile.rendered.XXXXXX")"
  render_caddyfile "${CADDY_SOURCE}" "${CADDY_RENDERED}"
  sudo install -m 0644 "${CADDY_RENDERED}" /etc/caddy/Caddyfile
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl enable caddy
  if sudo systemctl is-active --quiet caddy; then
    sudo systemctl reload caddy
  else
    sudo systemctl start caddy
  fi
fi

TARGET_SERVICES=("$@")

if [[ ${#TARGET_SERVICES[@]} -eq 0 && -n "${SERVICES:-}" ]]; then
  read -r -a TARGET_SERVICES <<< "${SERVICES}"
fi

if [[ ${#TARGET_SERVICES[@]} -gt 0 ]]; then
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull "${TARGET_SERVICES[@]}"
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d "${TARGET_SERVICES[@]}"
else
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans
fi
docker image prune -af --filter "until=168h" || true
