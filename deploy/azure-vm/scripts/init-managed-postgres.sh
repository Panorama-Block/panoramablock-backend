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
  docker run --rm \
    -e PGPASSWORD="${PGPASSWORD}" \
    postgres:16 \
    psql "sslmode=require host=${PGHOST} user=${PGUSER} dbname=postgres" \
    -v ON_ERROR_STOP=1 \
    -c "SELECT 'CREATE DATABASE ${db}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\\gexec"
done
