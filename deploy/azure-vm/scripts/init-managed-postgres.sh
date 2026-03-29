#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <host> <admin_user> <admin_password> <db1> [db2 ...]"
  exit 1
fi

PGHOST="$1"
PGUSER="$2"
PGPASSWORD="$3"
shift 3

export PGPASSWORD

for db in "$@"; do
  if [[ ! "$db" =~ ^[a-zA-Z0-9_]+$ ]]; then
    echo "invalid database name: $db" >&2
    exit 1
  fi

  exists="$(
    docker run --rm \
      -e PGPASSWORD="${PGPASSWORD}" \
      postgres:16 \
      psql "sslmode=require host=${PGHOST} user=${PGUSER} dbname=postgres" \
      -v ON_ERROR_STOP=1 \
      -tA \
      -c "SELECT 1 FROM pg_database WHERE datname = '${db}'"
  )"

  if [[ "${exists}" == "1" ]]; then
    echo "database ${db} already exists"
    continue
  fi

  docker run --rm \
    -e PGPASSWORD="${PGPASSWORD}" \
    postgres:16 \
    psql "sslmode=require host=${PGHOST} user=${PGUSER} dbname=postgres" \
    -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"${db}\""
done
