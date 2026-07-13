# 01 · Architecture & Stack

## 1. What airin is

airin is a **multi-tenant SaaS** for car-wash / automotive-service businesses. A single
deployment hosts many independent businesses ("tenants"). Each tenant operates:

- Multiple **branches** (outlets), each with two co-located **business units**: **AIRE**
  (car wash) and **LEAD** (detailing/polishing).
- **Point of sale**, an **arrival queue**, **memberships**, **vouchers & promotions**,
  **inventory / COGS**, **procurement**, **finance / P&L / settlement**, **HR & payroll**.
- **Customer self-service**: public eMenu, self-order kiosk, WhatsApp-OTP member portal,
  queue-status lookup, and appointment booking.
- **AI automation**: an in-app operations co-pilot and a WhatsApp customer agent, with an
  optional drag-and-drop flow builder (n8n).

All tenant data is isolated. The privilege ladder is
`platform_super_admin` → `tenant_owner` → `outlet_admin` → `cashier`.

## 2. Tech stack (at a glance)

| Layer | Technology |
|-------|-----------|
| Frontend | **Next.js 15** (App Router) · **React 19** · **Tailwind CSS v4** · lucide-react · zustand (light use) · TypeScript |
| Backend API | **NestJS 10 on Express** (migrated off Fastify) · **Socket.IO** · raw `pg` Pool · TypeScript |
| Shared code | `@aire/shared` workspace package — enums, constants, DTOs, and pure domain logic (cart calc, voucher/membership rules, module registry) shared by front + back |
| Database | **PostgreSQL 16** (`pgcrypto`), Row-Level-Security policies available, plain-SQL migrations |
| Cache / sessions | **Redis 7** (refresh-token store, password-protected) |
| Object storage | **MinIO** (S3-compatible) — logos, membership-card backgrounds |
| Messaging / IoT | **Eclipse Mosquitto** (MQTT) + a Node **IoT gateway** bridging bay sensors |
| WhatsApp | **WAHA** (self-host, QR-scan) or **Kapso** (cloud) per tenant |
| AI / LLM | **OpenRouter** (tenant key) or **Ollama/Hermes** (self-host), routed per tenant |
| Agent builder | **n8n** (hosted, admin-only) + a custom `n8n-nodes-aire` node calling the AIRE bridge |
| Reverse proxy | **nginx** (TLS, gzip, rate-limits, WebSocket upgrade) |
| Infra | **Docker Compose** |
| Testing | Vitest + Testing Library + **fast-check** (property-based) |

## 3. Monorepo layout

```
aire/
├── apps/
│   ├── backend/      # NestJS-on-Express API (port 4000) — 40 feature modules
│   ├── frontend/     # Next.js web app (port 3000) — dashboard, POS, kiosk, portal, admin
│   └── iot-gateway/  # MQTT → WebSocket bay-sensor bridge (port 4002)
├── packages/
│   └── shared/       # @aire/shared — enums, constants, DTOs, pure domain logic
├── database/
│   ├── migrations/   # 001…040 ordered plain-SQL migrations
│   ├── migrate.ts    # runner (schema_migrations tracking)
│   └── seed*.ts/mjs  # demo seed + users
├── integrations/
│   └── n8n-nodes-aire/  # custom n8n community node (AIRE bridge)
├── infrastructure/   # nginx, mosquitto configs, ssl
└── docker-compose.yml
```

> **Note:** the working clone keeps the app one level deep at `aire/aire/`. Earlier docs and
> the root README mention an `ai-service` app and "NestJS + Fastify" — both are **outdated**:
> there is no separate AI service (AI lives inside the backend `agent`/`whatsapp` modules), and
> the backend now runs on **Express**, not Fastify.

## 4. Service topology (Docker Compose)

All ports bind to `127.0.0.1` (loopback only) except the frontend; everything shares the
`aire-network` bridge. nginx is the only public entry point in production.

```
                          Internet
                             │
                     ┌───────▼────────┐   :80/:443
                     │     nginx      │   TLS, gzip, rate-limit, WS upgrade
                     └───┬───────┬────┘
             /  , /_next │       │ /api , /socket.io , /api/iot
                 ┌───────▼──┐ ┌──▼──────────┐
                 │ frontend │ │   backend   │  (Express + Socket.IO)
                 │  :3000   │ │    :4000    │
                 └──────────┘ └──┬───┬───┬──┘
                                 │   │   │
     ┌──────────┬──────────┬─────┘   │   └─────────┬───────────┐
 ┌───▼───┐  ┌───▼───┐  ┌───▼────┐ ┌──▼───┐    ┌────▼───┐   ┌────▼────┐
 │postgres│ │ redis │  │ minio  │ │ waha │    │  n8n   │   │mosquitto│
 │ :5432  │ │ :6379 │  │:9000/1 │ │:3001 │    │ :5678  │   │ :1883   │
 └────────┘ └───────┘  └────────┘ └──────┘    └────────┘   └────┬────┘
                                                                │ MQTT
                                                          ┌─────▼──────┐
                                                          │iot-gateway │ :4002
                                                          └────────────┘
```

| Service | Image | Internal port | Purpose |
|---------|-------|---------------|---------|
| `postgres` | postgres:16-alpine | 5432 | Primary database (vol `postgres_data`) |
| `redis` | redis:7-alpine | 6379 | Refresh-token / reset-token store, cache |
| `minio` | minio/minio | 9000 API / 9001 console | Object storage, bucket `aire-storage` |
| `mosquitto` | eclipse-mosquitto:2 | 1883 / 9883 | MQTT broker for IoT bay controllers |
| `backend` | apps/backend | 4000 | REST API + Socket.IO |
| `frontend` | apps/frontend | 3000 | Next.js web app |
| `iot-gateway` | apps/iot-gateway | 4002 | MQTT↔WebSocket bay-sensor bridge |
| `waha` | devlikeapro/waha | 3000 (→3001) | WhatsApp gateway (per WAHA-tenant) |
| `n8n` | n8nio/n8n | 5678 | Hosted agent-flow builder (admin only) |
| `nginx` | nginx:alpine | 80 (→8090 dev) | Reverse proxy |

## 5. Request path & routing

- Browser → **nginx** → `frontend` (`/`, `/_next/static`) or `backend` (`/api/*`,
  `/socket.io/*`, `/api/iot/*`).
- The frontend calls the API at `NEXT_PUBLIC_API_URL` (default `/api`, rewritten to the backend).
- nginx applies rate limits: `api` zone 30 r/s, `auth` zone 5 r/s (stricter on `/api/auth/`),
  `client_max_body_size 50m`, and WebSocket upgrade with 7-day timeouts for `/socket.io/`.
- **Real-time:** two Socket.IO namespaces — root `/` (order/bay/queue/payment/notification
  events, rooms `outlet:<id>` and `queue-board:<id>`) and `/agent` (AI proposal events,
  room `tenant:<id>`).

## 6. Integrations

### Payments
A single gateway abstraction (`PaymentProvider`) with **Xendit / Midtrans / Stripe / Sandbox**
implementations. Config is **per tenant** (`tenants.settings.payment`) with an env fallback.
A **sandbox key `"mock"`** runs the full dynamic-QRIS flow against the real DB but auto-confirms
the charge after a short delay — no real gateway needed for demos. Webhooks are signature-verified
per provider and funnel into one `confirmPaymentByReference` path that flips an order
`ordered → paid`. See [02 · Backend §Payment](02-backend.md#payment).

### WhatsApp (two distinct paths)
1. **Conversational agent** — `WhatsappService` talks to **WAHA** (self-host, connect by QR)
   or **Kapso** (cloud) using the tenant's `agent_configs`. Inbound webhook →
   `handleInbound` → built-in runtime **or** n8n flow (see below) → reply.
2. **Business-API notifications** — `NotificationService` sends templated messages
   (membership welcome, voucher delivery, expiry reminders, queue completion) via the WhatsApp
   Business API, with tenant creds and a global fallback.

### n8n agent builder
The **platform super-admin** builds drag-and-drop flows in a hosted n8n and publishes them to
the `agent_flows` catalog. A **tenant** selects a flow, flips `routing_mode` to `n8n`, and mints
a **bridge token**. On an inbound WhatsApp message the backend posts to the flow's webhook; the
flow calls back into the **AIRE bridge** (`/api/bridge/{context,llm,tool,whatsapp/send}`), which
re-applies every server-side guardrail — so a visual flow can never widen data scope. Any n8n
failure falls back to the built-in runtime. See [n8n-agent-builder.md](../n8n-agent-builder.md).

### Object storage (MinIO)
Branding logos and membership-card backgrounds are stored as S3 objects (keys
`tenants/<id>/logo`, `tenants/<id>/card-bg`). Only a short content-hash version is kept in
settings; images are served through versioned, cache-immutable public streaming endpoints.

### IoT / MQTT
The `iot-gateway` subscribes to bay-sensor topics
`aire/{tenant}/{outlet}/bay/{bay}/sensor`, validates readings (vehicle present, water flow,
foam level, machine status), and is designed to forward `bay:status-changed` events to the
backend Socket.IO. Bay gate/wash commands are published back on `.../command`. The sensor→UI
broadcast and gate MQTT publish are currently scaffolded stubs pending hardware.

## 7. Deployment (production VPS)

- Single dedicated VPS, Docker Compose, project name `aire`, served at
  **`app.useairin.id`** by nginx (80→443 redirect, Let's Encrypt TLS). n8n is exposed under
  `…/flows/` via an nginx subpath.
- The deploy overlays three compose files: `docker-compose.yml` +
  `docker-compose.prod.yml` (127.0.0.1 bindings + cert mounts) + `docker-compose.n8n.yml`
  (n8n override). All non-nginx ports are loopback-bound.
- Migrations are applied with `database/migrate.ts` (or `psql` for out-of-band files) and
  tracked in `schema_migrations`. There are **no down-migrations** — rollback is a git reset +
  rebuild.

### Key environment variables (see `.env.example`)
`JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_*`, `SETTINGS_ENCRYPTION_KEY`
(32-byte hex, encrypts tenant secrets), `PAYMENT_PROVIDER` + gateway keys, `WAHA_URL` /
`WAHA_API_KEY`, `KAPSO_URL`, `N8N_ENCRYPTION_KEY`, `BRIDGE_CALLBACK_BASE`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_N8N_URL`.

## 8. Security posture (summary)

- **Tenant isolation** is enforced primarily by explicit `WHERE tenant_id = $` predicates in
  every query; RLS policies (migration 003) exist and are used by the settings module via
  `RlsContextGuard`, but most modules rely on query-level scoping. See
  [02 · Backend §Auth](02-backend.md#2-authentication-roles--multi-tenancy).
- **Secrets** (LLM key, WhatsApp token) are encrypted at rest; gateway secrets are never
  returned to the client (masked).
- **Customer AI data isolation:** the WhatsApp agent resolves the customer server-side from the
  inbound phone number and can only ever read that customer's own data + public info — never
  other customers or financials, even under prompt injection.
- **Passwords** are bcrypt (cost 10). Access tokens live 15 min; refresh tokens 7 days with
  rotation in Redis.
</content>
