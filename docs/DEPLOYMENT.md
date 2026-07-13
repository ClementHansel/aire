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
