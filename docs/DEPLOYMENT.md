# AIRE — Deployment Guide

This is the single source of truth for running AIRE locally and on the VPS.
The Docker setup is split into a **production-safe base** plus two overlays:

| File | Role |
|------|------|
| `docker-compose.yml` | Base. Production-safe: builds the `production` image stage, no host source mounts, every internal service bound to `127.0.0.1`, nginx has **no** host port. |
| `docker-compose.dev.yml` | Dev overlay: hot-reload (`pnpm dev`) + source bind-mounts, `WAHA_MOCK=true`, nginx on a local-only port. |
| `docker-compose.prod.yml` | Prod overlay: nginx public on `80`/`443`, Let's Encrypt certs mounted, n8n on the `/flows/` subpath. |
| `docker-compose.bridge.yml` | Local SIMULATE-only run of the branch-bridge agent (in production it runs at the tenant's physical branch, not the VPS). |

> **Why the split?** Compose *concatenates* `ports` and `volumes` across `-f`
> files — an overlay can add entries but never remove them. So anything a
> production box must NOT have (dev source mounts, a dev-only nginx port) has to
> be absent from the base and added only by the dev overlay.

Services in the stack: `postgres`, `redis`, `minio`, `mosquitto`, `backend`,
`frontend`, `iot-gateway`, `waha`, `n8n`, `nginx` (+ `mediamtx` under
`--profile demo`).

---

## 1. Local testing (do this before every deploy)

Prereqs: Docker, plus host `node` and `pnpm@9.15.4` (used by the DB migrator/seed).

```bash
cd aire
cp .env.example .env          # first time only; the committed .env already
                              # remaps host ports into a +50000 range
./scripts/local-up.sh         # bootstrap DB → build images one-by-one → start all
```

When it finishes:

- App (via nginx): <http://localhost:58090>
- Frontend direct: <http://localhost:53000>
- Backend health: <http://localhost:54000/health>
- n8n editor: <http://localhost:55678>
- Login: `owner@demo.com` / `password123` (platform admin: `superadmin@aire.com`)

Other commands:

```bash
./scripts/local-up.sh db      # re-run migrations + re-seed users only
./scripts/local-up.sh down    # stop (keeps volumes/data)
```

Manual equivalent (if you prefer):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Notes:
- `WAHA_MOCK=true` locally — the full WhatsApp pipeline runs without a real
  number (outbound lands in `wa_mock_outbox`; trigger inbound from the
  Conversation Log). Set it `false` only when testing a real WAHA session.
- Windows/Docker: if `docker compose restart backend` races the watch build
  (`Cannot find module dist/main`), use `up -d --force-recreate backend` instead.

---

## 2. Production deploy (VPS, OOM-safe)

The VPS is small (2 vCPU / ~7.4 GB). **Never** build all images at once — it
OOM-kills the box. `scripts/deploy-vps.sh` builds and starts **one service at a
time** and checks each build's real exit code (a piped build can hide failures).

### First-time setup on the VPS

```bash
cd ~/aire                                   # the git checkout
cp .env.prod.example .env                   # then edit every CHANGE_ME
#   - strong POSTGRES/REDIS/MINIO/JWT/WAHA passwords (openssl rand -hex 32)
#   - N8N_ENCRYPTION_KEY (stable! regenerating orphans n8n credentials)
#   - WAHA_MOCK=false
#   - real PAYMENT keys when going live (leave "mock" for sandbox)

# TLS + nginx: get a cert, then enable the prod server block
certbot certonly --webroot -w /var/www/certbot -d app.useairin.id
mv  infrastructure/nginx/conf.d/default.conf infrastructure/nginx/conf.d/default.conf.dev-off
cp  infrastructure/nginx/conf.d/ssl.conf.example infrastructure/nginx/conf.d/ssl.conf
#   (edit ssl.conf if your domain differs from app.useairin.id)

# Build the custom n8n node once (optional; n8n runs fine without it)
( cd integrations/n8n-nodes-aire && npm install && npm run build )
```

### Deploy / redeploy

```bash
./scripts/deploy-vps.sh up            # full one-by-one deploy
# or piecemeal:
./scripts/deploy-vps.sh migrate       # apply pending migrations only
./scripts/deploy-vps.sh build backend # rebuild + restart one service
./scripts/deploy-vps.sh restart nginx
./scripts/deploy-vps.sh status        # docker ps + migration status
```

`up` sequence: data services → migrations → **backend** (build→start→wait) →
**frontend** → **iot-gateway** → waha + n8n → nginx (then `nginx -t && reload`
so the n8n upstream resolves).

Under the hood every command uses:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml <...>
```

### Manual redeploy of a single service (matches the historical recipe)

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C build backend > /tmp/b.log 2>&1; echo EXIT=$?; tail -3 /tmp/b.log   # capture TRUE exit
$C up -d --force-recreate backend
```

---

## 3. Database migrations

- Runner: `database/migrate.ts` (host) — applies every unapplied `*.sql` in
  `database/migrations/` in lexical order, tracked in the `schema_migrations`
  table (`version` = filename without `.sql`).
- On the VPS the prod backend image does **not** ship the runner, so
  `deploy-vps.sh migrate` re-implements the same logic against the postgres
  container via `psql` (one file per transaction, same tracking table).
- **Fresh-DB bootstrap:** migrations `017/018/020/022–024` seed the AIRE demo
  tenant's branches and FK to tenant `11111111-…-111111111111`, so that tenant
  row must exist first. Both scripts handle this automatically (insert the
  tenant between two resumable migrate passes).
- **Known wart:** there are two `049_*.sql` files (`049_platform_invoices`,
  `049_branch_bridges_cctv`). They have distinct version strings so both apply
  cleanly (branch_bridges sorts first); don't renumber them — they're already
  recorded as applied on the VPS, and renaming would re-run them.

---

## 4. Ports & exposure

Everything except nginx is bound to `127.0.0.1` in every configuration.

| Service | Container port | Local host port | Prod exposure |
|---------|---------------|-----------------|---------------|
| nginx | 80 / 443 | `127.0.0.1:58090` (dev) | **public 80 + 443** |
| frontend | 3000 | `127.0.0.1:53000` | `127.0.0.1:3000` (nginx proxies) |
| backend | 4000 | `127.0.0.1:54000` | `127.0.0.1:4000` |
| iot-gateway | 4002 | `127.0.0.1:54002` | `127.0.0.1:4002` |
| postgres | 5432 | `127.0.0.1:55432` | `127.0.0.1:5432` |
| redis | 6379 | `127.0.0.1:56379` | `127.0.0.1:6379` |
| minio | 9000/9001 | `127.0.0.1:59000/1` | `127.0.0.1:9000/1` |
| mosquitto | 1883/9883 | `127.0.0.1:51883/9883` | `127.0.0.1:1883/9883` |
| waha | 3000 | `127.0.0.1:53001` | `127.0.0.1:3001` |
| n8n | 5678 | `127.0.0.1:55678` | `127.0.0.1:5678` (public via nginx `/flows/`) |

The only public listeners on the VPS should be `22` (ssh) and `80`/`443` (nginx).

---

## 5. Rollback

No migration is destructive, but app rollback is: check out the previous commit
and rebuild the affected service(s):

```bash
git reset --hard <previous-commit>
./scripts/deploy-vps.sh build backend    # + frontend if it changed
```

---

## 6. Backups — set this up before onboarding a second company

One Postgres instance holds **every** tenant's orders, memberships and ledger.
A lost volume is not one customer's outage, it is all of them at once.

```bash
# One-off dump (writes backups/airin-<stamp>.sql.gz, then verifies it)
./scripts/backup-db.sh

# What is on disk
./scripts/backup-db.sh --list

# Prove a specific dump is restorable (gzip integrity + pg_dump completion marker)
./scripts/backup-db.sh --verify backups/airin-20260916-021500.sql.gz
```

Install the nightly job (02:15, 14-day retention):

```bash
(crontab -l 2>/dev/null; \
 echo '15 2 * * * cd /home/ubuntu/aire && ./scripts/backup-db.sh >> /var/log/airin-backup.log 2>&1') \
 | crontab -
```

The script writes to `*.partial` and only renames on success, so an interrupted
run can never leave a file that *looks* like a usable backup. It also refuses to
report success unless the dump ends with pg_dump's own completion marker — size
alone is not evidence of a good backup.

**Restore (destructive — this drops and recreates every object):**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
gunzip -c backups/airin-<stamp>.sql.gz \
  | docker compose -f docker-compose.yml -f docker-compose.prod.yml \
      exec -T postgres psql -U aire -d aire
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```

Copy dumps off the VPS periodically. A backup on the same disk as the database
does not survive the failure it exists for.

---

## 7. Onboarding a new company (tenant)

1. **Super-admin → Tenants → Create Tenant.** Set **Type of business**
   (`vertical`) on the first step. This is effectively permanent: it decides the
   starter business units and whether vehicle fields (plate, brand, model, bays,
   LPR) exist for them at all. A car wash gets Wash/Detailing; a services, F&B or
   laundry tenant gets no vehicle concepts anywhere in the UI.
2. Provisioning seeds business units, payment methods and the chart of accounts
   automatically. The vehicle catalog is seeded **only** for a vehicle vertical.
3. The owner login created here is gated into the onboarding wizard on first
   sign-in (legal entity → branch → services → staff → finance).
4. Per-tenant WhatsApp/AI credentials are configured by the tenant themselves
   under AI Agent, or by a super-admin via "view as".
5. **Give the tenant its own WhatsApp gateway** — see section 9. Skipping this
   leaves the tenant with no WhatsApp line at all (it will honestly report "Not
   configured"); it does NOT quietly share the existing one.

`ALLOW_SELF_SIGNUP` must stay `false` in production — `POST /api/auth/register`
would otherwise let anyone create an active tenant, bypassing this flow, the
vertical choice, and billing.

## 8. Row-level security (tenant isolation in the database)

Tenant isolation is enforced by **application code**: every query against a
tenant-owned table must carry `tenant_id`. Postgres RLS is not yet a backstop,
and until it is, a forgotten predicate is a silent cross-tenant leak. Two have
happened: the reports leak (July 2026) and the public kiosk queue-status leak
(`2928584`).

**Where this stands.** Migration 104 finished the database half:

```bash
# Policies and RLS-enabled tables, before -> after 104
#   35 policies / 29 tables  ->  113 policies / 107 tables
docker exec aire-postgres psql -U aire -d aire -tAc \
  "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity);"
```

It also created the role the policies bind to, `aire_app` (LOGIN, **NOSUPERUSER,
NOBYPASSRLS**). All of it is **inert** today, because the backend still connects
as `aire`, which is SUPERUSER and BYPASSRLS — so every policy is skipped. That
is deliberate: the database side is ready and provably correct, and switching it
on is a separate, reversible change.

**What it buys, measured on a clone of this schema.** Acting as `aire_app` with
`app.tenant_id` set to tenant B:

| case | before | with RLS |
|---|---|---|
| `SELECT count(*) FROM wa_conversations` (no predicate) | both tenants | only B |
| `SELECT … FROM customers WHERE id = '<A's id>'` | A's row | 0 rows |
| `INSERT … (tenant_id = A)` | succeeds | `new row violates row-level security policy` |
| `UPDATE … WHERE tenant_id = A` | updates A | 0 rows |
| `app.tenant_id` unset | n/a | 0 rows — **fail-closed** |

That is what turns the ~256 unscoped queries in the tenant-scope baseline from
unknown risk into bounded risk.

### Turning it on (phase 2, not yet done)

Three things are required, in this order. Do not do them piecemeal.

1. **Set a password and switch the connection.**
   ```bash
   docker exec aire-postgres psql -U aire -d aire \
     -c "ALTER ROLE aire_app PASSWORD '<generated>';"
   # then point the backend's DATABASE_URL / POSTGRES_USER at aire_app
   ```

2. **Set `app.tenant_id` per request.** Nothing in the backend does this today
   (`grep -rn "set_config" apps/backend/src` returns nothing). It needs a
   request-scoped tenant context and a pool that applies it. Two traps, both
   measured:
   - **Never set the empty string.** `current_setting('app.tenant_id', true)`
     returning `''` makes `''::uuid` raise *invalid input syntax for type uuid*,
     and the connection keeps erroring until the setting is reset. A request
     with no tenant (login, a public webhook before resolution) must **RESET**
     the setting, not blank it.
   - **Set it on every checkout, never inherit.** A session-level `set_config`
     survives on a pooled connection across requests. Re-scoping on the same
     connection works correctly, so per-checkout assignment is sound — but
     relying on a previous request's value would serve the wrong tenant.

3. **Audit every path with no tenant in context** and give it a privileged
   connection. This is the risky part, and the reason the flip is not a
   one-liner: a super-admin endpoint, a cron sweep (membership expiry, approval
   SLA, notification drain, broadcast scheduler) or a webhook handler that runs
   with no `app.tenant_id` gets **zero rows, silently** — fail-closed protects
   data but breaks automation quietly. The ~37 platform-scoped queries the
   tenant-scope triage identified are the starting list; they need a second pool
   connecting as `aire` (BYPASSRLS), selected explicitly rather than by default.

Until step 3 is complete, leave the backend on `aire`. A half-migrated rollout
trades a leak risk for a silent-data-loss risk.

## 9. WhatsApp gateways — one container per tenant

The WAHA image we run is tier **CORE**, which serves exactly **one** session and
it must be named `default`:

```bash
docker exec aire-waha sh -c 'curl -s http://localhost:3000/api/server/version \
  -H "X-Api-Key: $WHATSAPP_API_KEY"'
# {"version":"…","engine":"NOWEB","tier":"CORE",…}
```

So a session name cannot address a second tenant's line. Each tenant that needs
WhatsApp gets **its own container**, registered under
**Admin → WhatsApp Gateways**. (Upgrading to `devlikeapro/waha-plus` would allow
several named sessions on one container and make the extra containers
unnecessary — the registry keeps working either way.)

Provisioning a gateway for tenant #2:

```bash
# 1. Start the second gateway (compose profile, so it stays off by default).
docker compose --profile waha2 up -d waha-tenant2

# 2. Admin → WhatsApp Gateways → Register gateway
#      Name:     waha-tenant2
#      Base URL: http://waha-tenant2:3000     (docker service name, not localhost)
#      API key:  whatever WAHA2_API_KEY is set to
#    "Check" should report reachable + tier CORE.

# 3. Same page → Per-tenant transport → set the tenant's Gateway to it,
#    then "Issue token" (or "Copy" an existing one) to get its inbound URL:
#      /api/whatsapp/webhook/<token>

# 4. Put that URL in .env so the container posts inbound to the right tenant,
#    and restart it:
#      WAHA2_HOOK_URL=http://backend:4000/api/whatsapp/webhook/<token>
docker compose --profile waha2 up -d waha-tenant2

# 5. The tenant sets its WhatsApp number + session name `default` under
#    AI Agent, then Connect / Get QR and scans it on that tenant's phone.
```

**The token is the inbound identity** (migration 103). Every Core container
reports the session name `default`, so the session name can no longer tell
tenants apart — and `POST /api/whatsapp/webhook` was a public endpoint that
trusted that guessable name, meaning anyone could inject messages into a
tenant's agent. Two consequences:

- Each container's `WHATSAPP_HOOK_URL` must carry **its own** tenant's token
  (`WAHA_HOOK_URL` for the platform container, `WAHA2_HOOK_URL` for the second).
- Once every container is re-pointed, set `WA_WEBHOOK_REQUIRE_TOKEN=true` on the
  backend to close the tokenless route for good. Leave it unset during the
  rollout: session-name resolution still works (with a warning in the log) so a
  container you have not re-pointed yet keeps receiving messages.

Rotating a token invalidates the old URL immediately — update the container's
`WHATSAPP_HOOK_URL` in the same breath or that tenant stops receiving messages.

Checking isolation at a glance: on **Admin → WhatsApp Gateways**, the
Per-tenant transport table flags in red any two tenants sitting on the same
gateway with the same session name. That combination means they are sharing one
WhatsApp line.
