#!/usr/bin/env bash
# =============================================================================
# AIRIN — Postgres backup
# =============================================================================
# ONE Postgres instance holds EVERY tenant's orders, memberships and ledger.
# Losing it loses every customer at once, so this is not optional once a second
# company is on the platform.
#
# Run from the repo root ON THE VPS:
#   ./scripts/backup-db.sh                 # write a new dump, prune old ones
#   ./scripts/backup-db.sh --verify FILE   # check a dump is readable + complete
#   ./scripts/backup-db.sh --list          # show what is on disk
#
# Install as a nightly cron (02:15, keeps the log):
#   (crontab -l 2>/dev/null; echo '15 2 * * * cd /home/ubuntu/aire && ./scripts/backup-db.sh >> /var/log/airin-backup.log 2>&1') | crontab -
#
# RESTORE (destructive — read docs/DEPLOYMENT.md first):
#   gunzip -c backups/airin-YYYYmmdd-HHMMSS.sql.gz | \
#     docker compose exec -T postgres psql -U aire -d aire
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

# .env carries POSTGRES_* — load it without exporting every unrelated var into
# the caller's shell, and tolerate its absence (docker defaults then apply).
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

PGUSER="${POSTGRES_USER:-aire}"
PGDB="${POSTGRES_DB:-aire}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# The dump is only meaningful if it ends with pg_dump's own completion marker.
# A truncated dump (disk full, container killed mid-write) still gunzips fine,
# so size alone is NOT evidence of a good backup.
verify_dump() {
  local f="$1"
  [ -f "$f" ] || { echo "MISSING: $f"; return 1; }
  if ! gunzip -t "$f" 2>/dev/null; then
    echo "CORRUPT (bad gzip): $f"; return 1
  fi
  if ! gunzip -c "$f" | tail -5 | grep -q 'PostgreSQL database dump complete'; then
    echo "TRUNCATED (no completion marker): $f"; return 1
  fi
  local tables
  tables=$(gunzip -c "$f" | grep -c '^CREATE TABLE' || true)
  echo "OK: $f ($(du -h "$f" | cut -f1), ${tables} tables)"
}

case "${1:-backup}" in
  --list)
    ls -lh "$BACKUP_DIR"/airin-*.sql.gz 2>/dev/null || echo "No backups in $BACKUP_DIR"
    exit 0
    ;;
  --verify)
    verify_dump "${2:?usage: $0 --verify <file>}"
    exit $?
    ;;
esac

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/airin-$STAMP.sql.gz"

echo "[backup] dumping $PGDB as $PGUSER -> $OUT"
# Write to a .partial name first so an interrupted run can never leave something
# that looks like a usable backup, and so retention never prunes a good dump in
# favour of a half-written one.
if ! $COMPOSE exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" --clean --if-exists \
     | gzip -9 > "$OUT.partial"; then
  echo "[backup] FAILED — pg_dump returned non-zero" >&2
  rm -f "$OUT.partial"
  exit 1
fi
mv "$OUT.partial" "$OUT"

# Verify what we just wrote. A backup nobody has read back is a guess.
if ! verify_dump "$OUT"; then
  echo "[backup] FAILED verification — keeping the file for inspection" >&2
  exit 1
fi

# Retention. -mtime is only applied to our own dump names, never the directory.
find "$BACKUP_DIR" -name 'airin-*.sql.gz' -type f -mtime "+$RETAIN_DAYS" -print -delete
echo "[backup] done. Retained $(ls -1 "$BACKUP_DIR"/airin-*.sql.gz 2>/dev/null | wc -l) dumps (${RETAIN_DAYS}d)."
