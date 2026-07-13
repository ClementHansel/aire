#!/usr/bin/env bash
# =============================================================================
# AIRE — local dev/test bring-up (bootstrap DB + start the whole stack)
# =============================================================================
# Brings the full stack up on THIS machine for testing before a VPS deploy.
# Idempotent: safe to run whether the DB is fresh or already seeded.
#
#   ./scripts/local-up.sh          # bootstrap + build + start everything
#   ./scripts/local-up.sh db       # just (re)run migrations + seed users
#   ./scripts/local-up.sh down      # stop the stack (keep volumes/data)
#
# Uses docker-compose.yml + docker-compose.dev.yml (hot-reload, WAHA_MOCK on,
# nginx on a local-only port). Reads host ports from .env (the +50000 range).
#
# Requires: docker, and on the host node + pnpm@9.15.4 (for the TS migrator/seed).
# Fresh-DB note: migrations 017+ FK to the demo tenant, so we insert it between
# the two migrate passes (migrate.ts is resumable — it tracks applied files).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
DEMO_TENANT_ID="11111111-1111-1111-1111-111111111111"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f .env ] || { log "no .env — copying .env.example"; cp .env.example .env; }
# Load host ports (POSTGRES_PORT etc.) for the host-side migrator.
set -a; . ./.env; set +a
PGPORT="${POSTGRES_PORT:-55432}"
PGUSER="${POSTGRES_USER:-aire}"
PGPASS="${POSTGRES_PASSWORD:-aire_secret}"
PGDB="${POSTGRES_DB:-aire}"
export DATABASE_URL="postgres://${PGUSER}:${PGPASS}@127.0.0.1:${PGPORT}/${PGDB}"

wait_healthy() {
  local svc="$1" cid; cid="$($COMPOSE ps -q "$svc")"
  [ -n "$cid" ] || die "$svc not created"
  log "waiting for $svc"
  for _ in $(seq 1 40); do
    case "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null)" in
      healthy|running) ok "$svc up"; return 0 ;;
    esac
    sleep 3
  done
  die "$svc did not come up"
}

bootstrap_db() {
  log "Migrating (pass 1 — may stop at the first tenant-FK migration on a fresh DB)"
  pnpm --filter @aire/database migrate || true

  log "Ensuring demo tenant exists (idempotent)"
  $COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO tenants (id, name, slug, plan, status, settings) VALUES ('${DEMO_TENANT_ID}','Airin Demo','demo-car-wash','standard','active','{\"payment_methods\":[\"cash\",\"qris\",\"bank_transfer\"]}'::jsonb) ON CONFLICT (slug) DO NOTHING;" >/dev/null 2>&1 || true

  log "Migrating (pass 2 — applies the rest)"
  pnpm --filter @aire/database migrate

  log "Seeding users (owner@demo.com / superadmin@aire.com — pw: password123)"
  # The cashier row FKs a hardcoded outlet and may fail harmlessly; owner+admin land.
  node database/seed-users.mjs || true
  ok "DB ready"
}

case "${1:-up}" in
  down)
    log "Stopping stack (volumes kept)"; $COMPOSE down ;;
  db)
    $COMPOSE up -d postgres; wait_healthy postgres; bootstrap_db ;;
  up)
    log "1/4  Data services"
    $COMPOSE up -d postgres redis minio mosquitto
    wait_healthy postgres

    log "2/4  Bootstrap database"
    bootstrap_db

    log "3/4  Building app images one at a time (avoids local OOM)"
    for svc in backend frontend iot-gateway; do
      log "build $svc"; $COMPOSE build "$svc"
    done

    log "4/4  Starting everything"
    $COMPOSE up -d
    wait_healthy backend
    wait_healthy frontend

    ok "Local stack is up."
    echo "   App:      http://localhost:${HTTP_PORT:-58090}"
    echo "   Frontend: http://localhost:${FRONTEND_PORT:-53000}"
    echo "   Backend:  http://localhost:${BACKEND_PORT:-54000}/health"
    echo "   n8n:      http://localhost:${N8N_PORT:-55678}"
    echo "   Login:    owner@demo.com / password123"
    $COMPOSE ps ;;
  *)
    die "usage: local-up.sh [up|db|down]" ;;
esac
