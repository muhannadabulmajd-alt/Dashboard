#!/usr/bin/env bash
# Bring up a local PostgreSQL for development in an ephemeral container:
# starts the cluster and creates the `laheeb` role + database (idempotent).
set -euo pipefail

echo "Starting PostgreSQL cluster…"
pg_ctlcluster 16 main start 2>/dev/null || service postgresql start 2>/dev/null || true

echo "Ensuring role and database…"
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='laheeb'\" | grep -q 1 \
  || psql -c \"CREATE ROLE laheeb WITH LOGIN PASSWORD 'laheeb' CREATEDB;\""
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='laheeb'\" | grep -q 1 \
  || psql -c \"CREATE DATABASE laheeb OWNER laheeb;\""

echo "PostgreSQL ready at postgresql://laheeb:laheeb@127.0.0.1:5432/laheeb"
