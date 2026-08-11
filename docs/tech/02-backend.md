# 02 · Backend — Stack & Flows

The backend is a **NestJS 10 application running on Express** (migrated off Fastify). It is a
modular monolith: ~40 feature modules under `apps/backend/src/modules`, each a NestJS module
with its own controller(s) + service(s). All database access is raw SQL through a single `pg`
`Pool` injected as `DATABASE_POOL`. Framework entry: `apps/backend/src/main.ts` (ExpressAdapter,
`useBodyParser('json', { limit: '10mb' })` — branding/card images travel as base64 JSON).

- Base path for all HTTP routes: **`/api`**.
- Real-time via **Socket.IO** (namespaces `/` and `/agent`).
- Shared types/enums/constants from `@aire/shared`.

---

## 1. Module map

| Domain | Modules |
|--------|---------|
| **Identity & access** | `auth`, `access` (RBAC users/roles/permissions), `tenant`, `outlet` |
| **POS & commerce** | `order`, `payment`, `payment-method`, `service`, `catalog`, `shift`, `vehicle-queue`, `vehicle-catalog`, `receipt` (invoices) |
| **Membership & customers** | `membership`, `membership-card`, `customer`, `voucher`, `voucher-ticket`, `promotion`, `booking`, `settlement`, `sales` |
| **Self-service** | `kiosk`, `portal` |
| **Inventory / COGS / finance** | `inventory`, `recipe` (COGS/opname/reports), `procurement`, `finance` |
| **People** | `hr`, `payroll` (in the hr module tree) |
| **Reporting** | `report`, `monitoring`, `audit` |
| **AI** | `agent` (co-pilot), `whatsapp`, `agent-bridge` (n8n), `agent-config`, `agent-registry`, `ai` (legacy stub) |
| **Platform / config** | `admin`, `branding`, `settings`, `tenant-modules`, `storage` |
| **IoT / hardware** | `bay`, `cctv`, `discovery`, `realtime`, `notification` |

---

## 2. Authentication, roles & multi-tenancy

### Roles & hierarchy
Four base roles, privilege-ordered (`packages/shared/src/enums.ts`, `constants.ts`):

| Role | Level | Scope |
|------|-------|-------|
| `platform_super_admin` | 4 | The whole platform, all tenants (`outlet_id` null) |
| `tenant_owner` | 3 | One tenant, all its branches (`outlet_id` null) |
| `outlet_admin` | 2 | Branch(es) they're placed in |
| `cashier` | 1 | Branch(es) they're placed in |

`@Roles(X)` on a route means **"role X or higher."** So `@Roles(OutletAdmin)` also admits owner
and super-admin. `OUTLET_SCOPED_ROLES = [outlet_admin, cashier]` carry a mandatory `outlet_id`;
higher roles are tenant-wide. Tenants also define **custom roles** (`roles` table) each mapped to
a base role + a permission set (RBAC via the `access` module).

### JWT
- **Access token** (15 min): claims `sub` (user id), `tenant_id`, `outlet_id` (or null),
  `role`, `iat`, `exp`. Claim names are snake_case; there is **no `typ`** on staff tokens.
- **Refresh token** (7 days): `{ sub, tid, type:'refresh' }`, backed by a Redis key
  `refresh:<userId>:<tid>`; **rotated** (old key deleted) on each use.
- **Customer portal token** (2 h): `{ sub: customerId, tenant_id, typ:'customer' }` — a separate
  namespace; `PortalGuard` requires `typ==='customer'`, so staff and customer tokens can never
  cross surfaces.
- **Kiosk** uses no JWT — an opaque per-device token (`kiosk_devices.token`) via header
  `x-kiosk-token` or `?kioskToken=`.
- **Bridge (n8n)** uses a per-tenant `bridge_token` via header `X-Aire-Bridge-Token`.

### Guards
- `JwtAuthGuard` — validates the Bearer access token, attaches `request.user`.
- `RolesGuard` — reads `@Roles()`; **no decorator ⇒ allow any authenticated user**. Enforces the
  hierarchy and, for outlet-scoped roles, blocks a request whose target `outletId` differs from
  the user's own outlet.
- `RlsContextGuard` — opens a dedicated connection, `SET LOCAL app.tenant_id/outlet_id/role`,
  attaches it as `request.dbClient` (used by the `settings` and `discovery` modules).
- `PortalGuard`, `KioskTokenGuard`, `BridgeTokenGuard` — the three non-JWT auth guards above.

### Multi-tenancy enforcement
Two mechanisms coexist:
1. **Explicit predicates (dominant):** every service query includes `AND tenant_id = $`. This is
   the primary isolation mechanism for POS, orders, shifts, inventory, memberships, etc.
2. **Branch scoping via `ScopeService.resolveOutletIds(user, requestedOutletId)`:** owners/super
   see all branches (or a requested one); outlet-scoped roles are intersected with their assigned
   outlets (home outlet ∪ scheduled branches ∪ JWT outlet). Contract: `null` = all, `[]` = none,
   `[ids]` = restricted. Used by finance, inventory, report, customer list, bookings.

> **Hardening applied (2026-07-11):** three isolation gaps found during the documentation trace are
> now fixed. (1) `GET /api/orders` now always applies a `tenant_id` predicate — `OrderQueryParams`
> carries a required `tenantId` and `OrderListService.buildWhereClause` emits `o.tenant_id = $1`
> before any other filter, so an owner/super-admin with no `outletId` filter can no longer list
> across tenants. (2) `RlsContextGuard` now sets the RLS session GUCs with **bound parameters**
> (`SELECT set_config('app.tenant_id', $1, true)`) instead of interpolating JWT values into a
> `SET LOCAL '…'` string, closing the injection vector. (3) The `customer` controller's
> search / profile / analytics routes previously carried a `@Roles()` decorator with **no guard
> attached** (making it inert — the routes were effectively unauthenticated) and their service
> queries had **no `tenant_id` predicate** — together a cross-tenant customer-PII leak. The
> controller now has a class-level `@UseGuards(JwtAuthGuard, RolesGuard)` (`@Roles(OutletAdmin)`
> per route) and `getProfile` / `getAnalytics` / `searchCustomers` are tenant-scoped.

### Login / register / reset
- **Login** (`POST /api/auth/login`): email normalized (trim+lowercase), inactive users rejected,
  bcrypt compare, returns `{ accessToken, refreshToken, user }`. Generic error (no enumeration).
- **Register** (`POST /api/auth/register`): self-service tenant signup — creates `tenants` +
  a `tenant_owner` user in one transaction, seeds default automation settings, assigns a global
  **tenant code** (6-char base-36) after commit, and auto-logs-in.
- **Reset**: `forgot-password` stores a UUID token in Redis (30-min TTL, returned in the response
  — no email channel wired); `reset-password` consumes it and bcrypt-hashes the new password.
- **Impersonation**: a super-admin can mint a token acting as a tenant's earliest owner
  (audited); used by the admin panel "impersonate" button.

---

## 3. POS & order flows

### Order creation — `OrderService.createOrder()`
Runs a single transaction. Steps:
1. Look up services (price, `is_main_service`, business unit). One receipt may mix AIRE + LEAD
   lines; the order's `business_unit` records the payment channel.
2. Validate via shared `validateOrder` (injects membership plates when `membershipId` is set).
3. **Membership pricing** — only when `getMembershipBenefits` finds a membership that is
   `status='active' AND end_date >= CURRENT_DATE`. Date-expired-but-stale rows grant nothing.
   Captures `homeOutletId` + `settlementAmount` for cross-branch settlement.
4. **Shift attachment (branch inheritance)** — uses the caller's provided shift (kiosk/branch)
   or the cashier's own open shift. **No open shift → 400 "Open a shift before taking orders."**
   The order's operating outlet comes from the shift, so finance always matches where cash lands.
5. Resolve **vouchers** (pack child codes + shareable digital tickets) and **promotions**
   (active, within date, under quota) read-only.
6. Read outlet config (`service_charge_pct`, `tax_pct`); compute cart summary (subtotal, service
   charge, tax, total) via shared logic.
7. Generate `order_number` (`ORD-YYYYMMDD-NNN` per outlet/day).
8. Insert `orders` (`status='ordered'`, `channel` = pos/kiosk/customer, `shift_id`), `order_items`
   (flag member-priced lines), and an initial `order_status_logs` row.
9. **Atomic redemption** — single-use `UPDATE voucher_codes … WHERE status='active'` (rollback if
   concurrently consumed); promotion grants + quota decrement; membership usage + cross-branch
   `settlement_entries`.
10. **COGS deduction** (`applyRecipeCogs`) — runs inside the same transaction (see §5).
11. **Queue link** — if `queueEntryId` is passed, back-link `vehicle_queue.order_id`.
12. COMMIT, then emit `OrderCreated`, assign customer tags (best-effort).

### Payment — `OrderService.payOrder()` and gateway path
- **Counter payment** (`POST /api/orders/:id/pay`): only from `status='ordered'`. Cash requires
  `amountReceived ≥ total` and computes change. **Shift re-stamp:** the paying cashier's open
  shift is re-resolved and stamped onto the order (`shift_id = COALESCE(payShift, shift_id)`), so
  a kiosk-created order collected at the counter is booked into the right drawer. Sets
  `status='paid', paid_at=NOW()`, emits `OrderPaid`.
- **Dynamic QRIS** (`POST /api/payments/charge/:orderId`): leaves the order `ordered`, stores a
  `payment_reference`, returns a QR string. A gateway webhook — or, for a sandbox `"mock"` key, a
  timed auto-confirm — calls `confirmPaymentByReference`, flipping `ordered → paid`. (The gateway
  path does not re-stamp the shift.)
- **Webhooks**: `/api/payments/webhook/{xendit,midtrans,stripe}` (public, signature-verified) →
  `confirmPaymentByReference`.
- **Void/cancel** (`DELETE /api/orders/:id`, OutletAdmin+): blocked when the order's shift is
  closed (day-lock); **restocks** recipe inventory idempotently (see §5); audited.

### Shifts — `shift` module
- **Open** (`POST /api/shifts/open`): one open shift per operator. An **attendance gate** checks
  today's `employee_schedules`; opening off-schedule (or with no schedule) requires a reason once,
  and is audit-logged. Records `opening_float`.
- **Close** (`POST /api/shifts/:id/close`): `expected = openingFloat + cashSales + pettyIn −
  pettyOut`; `variance = counted − expected`. A closed shift **day-locks** its orders (no
  edit/cancel). Also `petty-cash` and `issues` sub-endpoints.
- `resolveBranchShift(tenant, outlet)` is the single seam kiosk/branch orders use to attach to the
  branch's earliest open shift (multi-cashier ready).

### Vehicle queue — the operational board
Two orthogonal dimensions on `vehicle_queue`:
- **Service status** — `waiting → serving → done` (or `cancelled`), set on the board.
- **Payment status** — **derived** from the linked order (no duplicated field): no order or unpaid
  order = `unpaid`; order in `paid/confirmed/completed` = `paid`.

Flow: a car arrives (`POST /api/vehicle-queue`, position = max+1) with plate/brand/model, no order
needed. The cashier picks it in POS ("Proses Bayar") → the order is created with `queueEntryId` →
`vehicle_queue.order_id` is back-linked. Marking a car **`done` requires the linked order to be
paid** (guarded: *"Collect payment before marking this car done."*). Kiosk self-orders instead
insert a fresh queue row already carrying the order id.

### Interface-aware out-of-stock block
Customer-facing channels block products whose **recipe can't be fulfilled from current stock**;
the **POS is intentionally not gated** (a cashier can always ring up a sale — stock may go
negative, allow-and-alert). `KioskService.getOutOfStockServiceIds` computes, per service, whether
any recipe component (unit-converted) exceeds the item's current quantity; the kiosk order create
rejects blocked lines and the public eMenu greys them out.

---

## 4. Membership, vouchers, portal & kiosk

Membership is documented end-to-end in [06 · Membership](06-membership-lifecycle.md). Key backend
facts:

- **Statuses:** `pending → active → grace (H+1..H+14) → revoked (H+15+)`, plus manual `suspended`
  and terminal `cancelled`. Canonical status comes from `MembershipLifecycleService.derive()` on
  every read; a job (`runTransitions`, boot + every 6 h, no `@nestjs/schedule`) writes the same
  values and appends `membership_events`.
- **Benefits guard:** granted only for `status='active' AND end_date >= CURRENT_DATE`.
- **Identity:** a 12-char base-36 membership number = tenant(6) + branch(2) + customer(4),
  allocated lazily at activation and reused across renewals.
- **Renewal:** `renew` creates a fee order + a **pending `membership_renewals`** row; the
  membership is extended/created only by `apply-renewal` **after** the order is paid (idempotent).
  Active/grace of the same plan → extend from current expiry; revoked or different plan → new.
- **Settlement:** a cross-branch membership wash writes a `settlement_entries` row (home branch
  owes serving branch); the `settlement` module nets and pays these out.

**Vouchers:** sellable **packs** (`voucher_packs` parent + hashed child `voucher_codes`, WhatsApp
delivered) and shareable **digital tickets** (`voucher_tickets`, human codes `BRANCH-MMYYYY-NNNNNN`
from `voucher_counters`). Both are validated read-only in POS and redeemed atomically inside the
order transaction. **Promotions** apply fixed/percentage discounts or grant free product/voucher/
future-discount under an optional quota.

**Customer portal** (`portal` module): WhatsApp-OTP login (6-digit, sha256-hashed, 5-min expiry,
30-s resend cooldown, 5-attempt cap, no phone-enumeration leak) → 2 h customer JWT. Endpoints:
`me` (full account), `orders`, `branches`, `queue` (sanitized, flags the customer's own plates),
`plans`, `renew` + `renew/status` (online QRIS renewal reusing the staff renewal machinery via a
synthesized system operator), and `bookings`. A portal booking sends the **branch cashier** a
one-tap WhatsApp confirm/reject link (`/confirm-booking/<token>`, public, unguessable token);
confirming creates a `vehicle_queue` entry and notifies the customer.

**Kiosk** (`kiosk` module): device-token auth; public eMenu (`/api/kiosk/menu`, annotates
`available` per stock) + queue-status lookup; and token-guarded `identify`
(plate → phone → number → UUID), self-order (`channel='kiosk'`, reuses `OrderService.createOrder`
via a synthesized login-disabled Kiosk operator, requires an open branch shift), pay-now QRIS, or
pay-at-cashier.

---

## 5. Inventory, COGS & finance

### COGS engine
A "product" is a `services` row (there is no products table). Its cost is:
- **Physical recipe / BOM** (`service_recipe_components`): inventory items consumed per one unit,
  in a stated unit.
- **Non-physical cost components** (`service_cost_components` → `cost_component_types`): `fixed`
  amount or `percentage` of price (tax, profit, water, electricity…).
- **UOM conversions** (`uom_conversions`): buy/stock in one unit, consume in another
  (e.g. kg ↔ g).

On sale, `applyRecipeCogs` (inside the `createOrder` transaction) explodes each line's BOM,
unit-converts to the item's stock unit, **deducts inventory** + writes a `sale` movement, adds
non-physical overhead, and **freezes `order_items.cost_snapshot`** so margin reports don't drift
when a recipe later changes. On cancel, `deleteOrder` restocks by reversing the `sale` movements
into `sale_return` movements — guarded by status so repeated cancels never double-restock.

### Stock opname (physical count)
`create` snapshots current book stock as `expected_qty`; staff enter `counted_qty`; `close`
computes `variance = counted − expected` and `variance_value`, reconciles
`inventory_items.quantity = counted`, and writes `adjustment` movements. Uncounted lines are
skipped.

### Reports & finance
- **COGS P&L** (`/api/cogs/pnl`): revenue − COGS (from `cost_snapshot`) − expenses ⇒ gross profit,
  gross margin %, net profit. Plus per-product margin and inventory variance (from a closed
  opname).
- **Simple finance summary** (`/api/finance/summary`): revenue − expenses only (**no COGS**), by
  category, with branch scoping.
- **Sales summary/forecast** (`/api/sales/summary`): month actual vs `sales_targets`; run-rate
  projection `projected = actual / dayOfMonth * daysInMonth`; attainment % + projected attainment
  %; lead funnel.
- **Report module** (`/api/reports/*`): KPIs, revenue/customer series, daily sales, per-shift cash
  reconciliation, and CSV / branded-PDF export.

### Procurement
Suppliers + purchase orders (`PO-YYYYMMDD-####`). `receivePurchaseOrder` marks the PO received and
**auto-restocks** each linked item via the shared `InventoryService.adjustStock` `in` primitive
(so movements + low-stock alerts fire). Idempotent via the already-received guard.

### HR & payroll
Employees (optionally linked 1:1 to a login account), schedules, attendance (clock in/out with
hours), leave (paid/unpaid), holidays. **Payroll** generation is transactional and idempotent per
period (a draft run is reversed and regenerated; a finalized run is locked): base salary + pending
bonuses − deductions − advances − loan installments − unpaid-leave deduction ⇒ one payslip per
employee. Export is **CSV only** (PDF lives in the report module).

---

## 6. AI stack

Two AI surfaces share strict, server-side data isolation.

### In-app operations co-pilot (`agent` module)
- A **tool registry** of read tools (business summary, list orders/customers/memberships/services,
  queue status, events, plus module read summaries) and **gated action tools** (create campaign,
  retention offer, queue-priority, anomaly flag, pricing suggestion, membership recommendation,
  and module actions like adjust-stock / record-expense / create-lead / create-PO / add-employee).
- **Execution gate** (`AgentService.executeTool`): tool exists → tenant/outlet present → AJV input
  validation → read-only tools bypass gating → the relevant **automation toggle** must be enabled →
  approval mode: `autonomous` executes (+audit) or `approval_required` creates an
  `action_proposals` row for owner sign-off. Retries with backoff; every call recorded to
  `agent_invocations`.
- **Chat assistant** (`/api/agent/chat`): a max-5-iteration tool-calling loop where the LLM emits
  JSON actions routed through the same gate. `ChatStoreService` owns threads for BOTH consoles
  (`agent_chat_sessions.scope` = `tenant` | `platform`): listing with previews, rename/pin/archive,
  and a one-completion-per-thread automatic titler. A `readOnly` option hides action tools (and
  re-checks on execute) for read-only callers.
- **Platform AI console** (`/api/admin/ai/chat`, `PlatformChatService`): the same loop with a
  CROSS-TENANT, deliberately read-only tool catalog (tenants, billing/invoices, ops feed, job
  heartbeats, AI usage, health). Super-admin only; no tool can mutate a tenant.
- **Scheduled analysis**: an in-memory scheduler runs enabled-toggle analyses, gathers a live data
  snapshot, asks the LLM for insights, and executes or proposes each.
- **LLM routing** (`LLMRouterService`): per-tenant **OpenRouter** (encrypted key, default
  `gpt-4o-mini`) or **Hermes/Ollama**; 30-s timeout; structured error types.

### WhatsApp customer agent (`whatsapp` module)
`handleInbound`: resolve tenant → upsert conversation + store message → **staff branch** (a DM from
an ACTIVE `wa_whitelist_numbers` row runs the full business agent via `AgentChatService`, bound to
`wa_conversations.chat_session_id` for continuity; it honours the master AI switch and the
per-conversation `ai_enabled`, but deliberately bypasses `ai_reply_enabled` and the daily cap, which
are customer protections) → otherwise gate on `ai_reply_enabled` + per-conversation `ai_enabled` +
a per-user daily cap → **route**:
- `routing_mode='n8n'` → POST the message to the selected flow's webhook (with bridge token +
  callback base); n8n calls back via the bridge. Any failure **falls back** to the built-in
  runtime.
- Built-in `AgentRuntimeService`: detect intent (human/status/membership/price/booking/voucher/
  hours/greeting/unknown), pick a persona from the `agents` registry, then **Fluid** (LLM with a
  heavily guard-railed system prompt) or **Rigid** (deterministic Indonesian templates); fluid
  errors fall back to rigid. `human` intent always escalates to the human `escalation_number`.
- **Data isolation:** `CustomerContextService` resolves the customer from the inbound phone
  server-side and exposes only that customer's memberships/orders/queue/vouchers/bookings + public
  info. No method returns other customers, financials, payroll, or cross-tenant data.

### n8n bridge (`agent-bridge` module)
Machine-auth (`BridgeTokenGuard`) endpoints `/api/bridge/{context, llm, tool, whatsapp/send}` —
all tenant-scoped so guardrails stay server-side. The `agent-flow` service owns the super-admin
flow catalog (`agent_flows`) and each tenant's selection + bridge-token rotation.

> **Legacy note:** the `ai` module (`/api/ai/query`, `/api/ai/chatbot/webhook`) and its
> `callLLM`/chatbot are older **stubs**; the production AI path is `agent` + `whatsapp` +
> `agent-bridge` + `LLMRouterService`. `agent_invocations` is the real telemetry.

---

## 7. Platform, config & supporting modules

- **`admin`** — platform control plane (platform-super-admin): tenant CRUD (assigns tenant code),
  suspend/reactivate, per-tenant module toggles, impersonation; **subscription plans**
  (`PlatformPlanService`, `platform_plans` table → priced MRR, monthly-equivalent for annual);
  platform config (default plans, feature flags); metrics (overview, enriched tenants, tenant
  detail, activity, timeseries, AI usage, ops monitoring); and health — DB latency + live WAHA
  reachability plus a **Docker** panel (`DockerService` reads container status/logs over a
  read-only `/var/run/docker.sock` mount; degrades gracefully when absent). Tenant `:id` route
  params accept a **slug or UUID** (`resolveTenantId`). (A second, plainer tenant CRUD lives in the
  `tenant` module — note it does **not** assign a tenant code.)
- **`branding`** — per-tenant company name, logo (MinIO object + versioned public stream), colors,
  fonts, dark-mode policy. `GET /api/public/branding` is unauthenticated and returns a default for
  unknown tenants (never 404).
- **`settings`** — per-tenant automation settings (AI enable, LLM provider + encrypted key,
  automation toggles, approval modes, WhatsApp creds), JSON-Schema-validated, secrets encrypted,
  audited.
- **`tenant-modules`** — `GET /api/modules/me` returns the enabled-module map (default-on).
- **`storage`** — S3/MinIO client + image upload/stream utilities.
- **`audit`** — `audit_logs` writer + `GET /api/audit-logs`; covers login, role change, void,
  plate ops, config change, PIN usage, membership/voucher events, impersonation, device confirms.
- **`notification`** — WhatsApp Business-API templated messages (tenant creds + global fallback);
  in-memory retry queue (BullMQ intended in production).
- **`realtime`** — Socket.IO root namespace emitters (order/bay/queue/payment/notification).
- **`bay` / `discovery` / `cctv`** — wash-bay status/assignment/gate, network device discovery
  (ONVIF/MQTT/SSDP), and CCTV stream/record. Hardware-facing parts are stubs pending
  infrastructure.

See the complete endpoint list in [05 · API Reference](05-api-reference.md).
</content>
