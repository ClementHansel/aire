# AIRE Operations Platform — Technical Documentation

This document describes the architecture, module map, data model, the WhatsApp
agent runtime (including its security model), and the migration history.

---

## 1. Stack & layout

- **Backend:** NestJS 10 (TypeScript), PostgreSQL 16 (`pg` pool), per-tenant data scoping.
- **Frontend:** Next.js 15 (App Router), React 19, Tailwind. `/api/*` is rewritten to the backend.
- **Shared:** `packages/shared` — enums, constants, pure helpers (`normalizePhone`, payment handler, etc.).
  Backend tests resolve `@aire/shared` to `src`; the production build uses the compiled `dist`.
- **Infra:** Docker Compose (postgres, redis, minio, mosquitto, backend, frontend, nginx, waha).

```
apps/backend/src/modules/<feature>/    # one folder per feature module
apps/frontend/src/app/                  # routes (dashboard, pos, kiosk, menu, admin, hub …)
database/migrations/NNN_*.sql           # ordered, tracked by database/migrate.ts
```

### Frontend route groups
- `/` login · `/hub` workspace launcher · `/dashboard/*` management · `/pos/[outletAgentId]/*` POS
- `/kiosk/[tenantId]` · `/queue-board/[outletId]` · `/menu/[tenantId]` (public eMenu) · `/admin/*` (super admin)

---

## 2. Backend module map (selected)

| Module | Responsibility |
|--------|----------------|
| `auth` | JWT auth, DB pool provider, guards |
| `admin` | Platform tenants, `platform_config` (plans/pricing/flags), billing view |
| `outlet` | Branches (code, legal entity, phone, maps URL) |
| `service` | Service catalog (business unit, category, region scope via `outlet_ids`) |
| `catalog` | Product categories + brands |
| `payment-method` | Per-branch payment buttons (logo/colour/kind) |
| `order` / `payment` | POS orders, promotions + settlement hooks, gateway charges |
| `membership` | Plans (free services, branch scope), member lookup, selling, renewal |
| `voucher` | Sellable **Service Pack** templates + pack issue/redeem |
| `voucher-ticket` | Shareable digital vouchers (`BRANCH-MMYYYY-NNNNNN`) |
| `promotion` | Promotions/campaigns (buy → free product/voucher/discount, quota) |
| `settlement` | Inter-branch settlement ledger + payouts |
| `booking` | Appointment bookings (CRUD + status flow) |
| `vehicle-queue` / `kiosk` / `bay` | Arrival queue, self-service status, public **eMenu** |
| `report` | Revenue/series/summary, CSV export |
| `agent` | Internal AI copilot + `LLMRouterService` (OpenRouter/Ollama) |
| `agent-config` | WhatsApp agent config (prompt, knowledge, provider, escalation, AI toggle) |
| `agent-registry` | Named agents (Oline/Ersa/CS1 …) — roles + prompts |
| `whatsapp` | WAHA/Kapso connection, inbound webhook, **agent runtime** + conversation log |
| `settings` | Per-tenant automation settings (JSON-schema validated, encrypted secrets) |

---

## 3. Data model highlights

- **Tenancy:** every domain table carries `tenant_id`; queries filter by it. The app DB role
  bypasses RLS, so scoping is enforced in the query layer (always `WHERE tenant_id = $...`).
- **Outlets** add `code`, `legal_entity`, `phone`, `maps_url`. Services/plans/packs scope to branches
  via `outlet_ids UUID[]` (empty/null = all branches); the POS passes the cashier's `outletId`.
- **Services** carry `business_unit` (AIRE/LEAD) and `category` (car_wash/add_on/product). LEAD detailing
  uses S-M / L-XL as separate rows; AIRE car wash is region-priced (Jabodetabek vs Surabaya).
- **Membership plans** carry `free_service_ids` (daily free wash), `discounted_services`, `outlet_ids`.
- **Agents** (`agents`): `name, role(personal_assistant|customer_service|sales|supervisor), prompt, is_active, position`.
- **WhatsApp:** `agent_configs` (one per tenant), `wa_conversations`, `wa_messages`.

---

## 4. WhatsApp agent runtime

Inbound flow (`whatsapp.service.handleInbound`):

1. Resolve tenant (explicit or by WAHA session) and upsert the `wa_conversations` row; store the inbound message.
2. Gate: reply only if `agent_configs.ai_reply_enabled` AND the conversation's `ai_enabled` are true, and the
   per-customer daily cap (`max_messages_per_day`) is not exceeded (else escalate).
3. Delegate to `AgentRuntimeService.generate(...)` with the recent history (last 8 turns).
4. Persist + send the reply (or escalate to the human `escalation_number`).

### `AgentRuntimeService`
- **Intent detection** (ID/EN keywords): `human, status, membership, price, booking, voucher, hours, greeting, unknown`.
- **Agent selection** from the registry by intent → role (`human`→customer_service/supervisor;
  sales-ish→sales; else personal_assistant; first active as fallback).
- **Mode** decided by `settings.ai_enabled` + a usable LLM (OpenRouter key present, or local provider):
  - **Fluid:** `LLMRouterService.chat()` with a system prompt = agent persona + base prompt + knowledge base
    + public info + the resolved customer's scoped context + strict guardrails, then history + the message.
  - **Rigid:** deterministic Indonesian templates filled with the same scoped data.
  - Fluid errors (no key / timeout) **fall back to rigid** so the customer always gets a reply.

### <a id="whatsapp-agent-runtime"></a>Security model (data isolation)
`CustomerContextService` is the **only** data gateway for agents:

- The customer is resolved from the inbound **phone number** (`normalizePhone` → `customers.phone_normalized`).
  The `customerId` is bound server-side and is **never** taken from message text or model output.
- Every scoped query filters by `tenant_id` **and** the bound customer (`customer_id`, or normalized phone for
  voucher books / bookings). Methods exist only for: that customer's memberships, orders, queue position,
  voucher packs, bookings — plus **public** info (services/prices, plans, active promotions).
- There is **no** method that returns other customers, revenue/finance, settlement, payroll, costs, or staff.
  Even under prompt injection the LLM cannot widen scope, because it is given finished context (not a tool that
  accepts a customer id). Unknown numbers → prospect mode (public info only).

---

## 5. Migrations (history)

`001–011` foundation (schema, RLS, triggers, order logs, voucher packs, AI platform, business modules,
POS shifts, HR/payroll, business units). `012` SaaS foundation (branch code/legal entity, multi-branch users,
product scope). `013` commerce (vouchers, promotions, settlement). `014` vehicle queue. `015–016` agent config
+ WA conversations. `017` AIRE branches + outlet phone/maps. `018` AIRE/LEAD pricing + membership plans.
`019` `platform_config` (fixes admin config/billing). `020` membership free services + 6-month tier.
`021` bookings. `022` agents registry (+ seed). `023` rename agents. `024` additional agents.

Run with `pnpm db:migrate` (or `database/migrate.ts` against `DATABASE_URL`). Migrations are append-only and
idempotent where practical.

---

## 6. Testing & verification

- `pnpm --filter @aire/backend test` (Vitest, incl. fast-check property tests).
- `pnpm --filter @aire/frontend test` + `tsc --noEmit` + `eslint src/`.
- After any change: type-check, lint, run affected tests, then build before deploy.
