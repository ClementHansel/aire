#!/usr/bin/env bash
# =============================================================================
# AIRE — OOM-safe VPS deploy (build + start ONE service at a time)
# =============================================================================
# The VPS is small (2 vCPU / ~7.4 GB). Building backend and frontend in parallel
# OOM-kills the box, and a failed build can masquerade as success if its output
# is piped (the pipe's exit code is the pager's, not the build's). This script
# avoids both: sequential builds, each with its real exit code checked.
#
# Run from the repo root ON THE VPS:
#   ./scripts/deploy-vps.sh up            # full one-by-one deploy (default)
#   ./scripts/deploy-vps.sh build backend # (re)build a single service
#   ./scripts/deploy-vps.sh migrate       # apply pending DB migrations only
#   ./scripts/deploy-vps.sh restart backend frontend
#   ./scripts/deploy-vps.sh status        # ps + migration status
#
# Assumes: a production .env exists (see .env.prod.example) and certs live at
# /etc/letsencrypt/live/<domain>/ with ssl.conf enabled (see docs/DEPLOYMENT.md).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
PGUSER="${POSTGRES_USER:-aire}"
PGDB="${POSTGRES_DB:-aire}"
MIG_DIR="database/migrations"
# Demo tenant that migrations 017+ reference via FK (AIRE branch seeds). Must
# exist before those migrations apply — see bootstrap_tenant().
DEMO_TENANT_ID="11111111-1111-1111-1111-111111111111"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

psql_q() { $COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }

# --- Build a single service, capturing its REAL exit code --------------------
build_one() {
  local svc="$1" logf="/tmp/aire-build-${1}.log"
  log "Building ${svc} (log: ${logf})"
  if $COMPOSE build "$svc" >"$logf" 2>&1; then
    ok "built ${svc}"
    tail -3 "$logf" || true
  else
    printf '\033[1;31m--- last 40 lines of %s ---\033[0m\n' "$logf" >&2
    tail -40 "$logf" >&2 || true
    die "build FAILED for ${svc}"
  fi
}

# --- Recreate + wait until healthy (or running, for services w/o healthcheck)-
up_one() {
  local svc="$1"
  log "Starting ${svc}"
  $COMPOSE up -d --force-recreate "$svc"
}

wait_healthy() {
  local svc="$1" tries="${2:-40}" name state
  name="$($COMPOSE ps -q "$svc")"
  [ -n "$name" ] || die "${svc} has no container"
  log "Waiting for ${svc} to be healthy"
  for _ in $(seq 1 "$tries"); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo unknown)"
    case "$state" in
      healthy|running) ok "${svc}: ${state}"; return 0 ;;
      unhealthy)       docker logs --tail 30 "$name" || true; die "${svc} is unhealthy" ;;
    esac
    sleep 3
  done
  die "${svc} did not become healthy in time (last state: ${state:-?})"
}

# --- Migrations (run against the postgres container; the prod backend image
#     does not ship the TS migration runner). Mirrors database/migrate.ts:
#     sorts *.sql, applies each unapplied file in ONE transaction, tracks it. ---
ensure_mig_table() {
  psql_q -v ON_ERROR_STOP=1 -c \
    "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, filename VARCHAR(255) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" >/dev/null
}

bootstrap_tenant() {
  # Idempotent. Required because migrations 017/018/020/022-024 INSERT rows that
  # FK to this tenant. Harmless if it already exists.
  psql_q -v ON_ERROR_STOP=1 -c \
    "INSERT INTO tenants (id, name, slug, plan, status, settings) VALUES ('${DEMO_TENANT_ID}', 'Airin Demo', 'demo-car-wash', 'standard', 'active', '{\"payment_methods\":[\"cash\",\"qris\",\"bank_transfer\"]}'::jsonb) ON CONFLICT (slug) DO NOTHING;" >/dev/null 2>&1 || true
}

migrate() {
  ensure_mig_table
  local applied pending=0 f version
  applied="$(psql_q -tAc "SELECT version FROM schema_migrations;" | tr -d '\r')"
  local did_bootstrap=0
  log "Applying pending migrations"
  # Sorted lexicographically — matches migrate.ts .sort().
  for path in $(ls "$MIG_DIR"/*.sql | sort); do
    f="$(basename "$path")"; version="${f%.sql}"
    if printf '%s\n' "$applied" | grep -qxF "$version"; then continue; fi
    printf '  applying %s ... ' "$f"
    if $COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -1 -f - <"$path" >/tmp/aire-mig.log 2>&1; then
      psql_q -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version, filename) VALUES ('$version', '$f');" >/dev/null
      printf 'ok\n'; pending=$((pending+1))
    else
      if [ "$did_bootstrap" -eq 0 ] && grep -qiE 'foreign key|violates.*tenant|not present in table' /tmp/aire-mig.log; then
        printf 'need tenant bootstrap\n'; bootstrap_tenant; did_bootstrap=1
        # retry this same file
        if $COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -1 -f - <"$path" >/tmp/aire-mig.log 2>&1; then
          psql_q -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version, filename) VALUES ('$version', '$f');" >/dev/null
          printf '  applying %s ... ok (after bootstrap)\n' "$f"; pending=$((pending+1)); continue
        fi
      fi
      printf 'FAILED\n'; tail -30 /tmp/aire-mig.log >&2; die "migration $f failed"
    fi
  done
  [ "$pending" -eq 0 ] && ok "database already up to date" || ok "applied $pending migration(s)"
}

# --- Full OOM-safe deploy ----------------------------------------------------
deploy_up() {
  command -v docker >/dev/null || die "docker not found"
  [ -f .env ] || die ".env missing — cp .env.prod.example .env and fill it in"

  log "1/6  Data services (pulled images, no build)"
  $COMPOSE up -d postgres redis minio mosquitto
  wait_healthy postgres
  wait_healthy redis

  log "2/6  Migrations"
  migrate

  log "3/6  Backend (build → start → wait)"
  build_one backend
  up_one backend
  wait_healthy backend

  log "4/6  Frontend (build → start → wait)"
  build_one frontend
  up_one frontend
  wait_healthy frontend

  log "5/6  IoT gateway (build → start)"
  build_one iot-gateway
  up_one iot-gateway

  log "6/6  WAHA + n8n + nginx"
  $COMPOSE up -d waha n8n
  $COMPOSE up -d nginx
  # nginx upstreams (n8n) may not have resolved when it first started; reload once up.
  sleep 2
  $COMPOSE exec -T nginx nginx -t && $COMPOSE exec -T nginx nginx -s reload || true

  log "Done."
  $COMPOSE ps
}

# --- Dispatch ----------------------------------------------------------------
cmd="${1:-up}"; shift || true
case "$cmd" in
  up)       deploy_up ;;
  build)    [ $# -ge 1 ] || die "usage: build <service...>"; for s in "$@"; do build_one "$s"; up_one "$s"; done; wait_healthy "$1" || true ;;
  migrate)  migrate ;;
  restart)  [ $# -ge 1 ] || die "usage: restart <service...>"; for s in "$@"; do up_one "$s"; done ;;
  status)   $COMPOSE ps; echo; psql_q -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;" 2>/dev/null || true ;;
  *)        die "unknown command '$cmd' (up|build|migrate|restart|status)" ;;
esac
