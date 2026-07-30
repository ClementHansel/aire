# 03 · Frontend — Stack & Flows

The frontend is a **Next.js 15 (App Router)** app in `apps/frontend`, React 19, Tailwind CSS v4.
It is the single web client for every surface: the management **dashboard**, the **POS**, the
**platform admin** panel, and the public **kiosk / portal / eMenu / queue board**.

---

## 1. Tech stack

- **Next.js `^15.5` (App Router)** + **React 19**.
- **Tailwind CSS v4** via `@tailwindcss/postcss`. Styling = utility classes + a set of semantic
  component classes (`.card`, `.btn-primary`, `.input-field`, `.badge`, …) and CSS
  custom-property design tokens (`bg-surface`, `text-text-primary`, `border-border`,
  `bg-primary-500`, …) driven by branding variables in `globals.css`. **No shadcn/ui / Radix** —
  UI is hand-rolled; icons via **lucide-react**; `clsx` + `tailwind-merge` for class composition.
- **State:** mostly local `useState`/`useEffect` + React Context; `zustand` is a dependency used
  sparingly. Cross-cutting state is Context-based (branding, theme, language).
- **Extra libs:** `html5-qrcode` (camera scan), `jsbarcode` + `qrcode` (membership-card codes).
- `@aire/shared` provides the same cart/voucher/membership calculations the backend uses, so POS
  totals match server totals.
- **Testing:** Vitest + Testing Library + fast-check; test files colocated (`*.test.tsx`).

### Structure (`src/`)
- `app/` — App Router route groups (see §3). Root `layout.tsx` loads fonts and wraps everything in
  `LanguageProvider`.
- `components/` — feature-grouped: `pos/`, `dashboard/`, `branding/`, `admin/`, `shared/`, plus
  `QrScanButton.tsx`.
- `lib/` — `api.ts` (authed client), `portalApi.ts`, `auth.ts` (session), `useModules.ts`,
  `i18n.tsx` + `locales/{en,id}.ts`, `publicBranding.ts`, `color-utils.ts`, `google-fonts.ts`,
  `cardCodes.ts`, `theme.ts`, `contrast.ts`, `utils.ts`.
- `contexts/` — `BrandingContext.tsx`, `ThemeContext.tsx`.

---

## 2. API client, auth & session

- **Base URL:** `NEXT_PUBLIC_API_URL || '/api'`.
- **`lib/api.ts`** — `apiFetch` prepends the base, sets JSON content-type (skipped for FormData so
  the browser sets the multipart boundary), attaches `Authorization: Bearer <accessToken>`. On
  **401** it calls `POST /auth/refresh` with the stored refresh token, re-stores the session, and
  retries once; on failure it clears the session and redirects to `/`. Exposes
  `api.get/post/put/patch/delete/upload`; throws a typed `ApiError`.
- **`lib/auth.ts`** — session in `localStorage` (`aire_access_token`, `aire_refresh_token`,
  `aire_user`). `AuthUser.role` ∈ the four roles + `tenantId`/`outletId`. Includes
  **impersonation** helpers (backs up the admin session, swaps in a tenant token).
- **Guarding:** there is **no server middleware** — each protected page/layout calls
  `isAuthenticated()` in an effect and hard-redirects to `/` if missing. Deeper enforcement is
  server-side (role guards + query scoping). Login routes **cashiers → POS**, everyone else →
  **`/hub`**.

### Contexts
- **`BrandingContext`** (authed dashboard) — fetches `GET /branding/me`, applies brand colors,
  exposes `companyName`, `logoUrl`, `tenantCode`, `refreshBranding`. Public surfaces use
  `usePublicBranding(tenantId)` → `GET /public/branding?tenantId=` (no auth) applying colors +
  Google fonts.
- **`ThemeContext`** — light/dark with a tenant policy (`dark_mode_enabled`, `forced_theme`,
  `default_theme`); persists `aire-theme`.
- **`LanguageProvider`** (`lib/i18n.tsx`) — `useI18n()` + `t(key, fallback)`, locales `en`/`id`
  (flat dicts, EN → inline fallback), persisted in `aire_lang`. A `<LanguageToggle/>` sits in the
  dashboard, POS, portal, kiosk, and confirm-booking headers. The whole app is bilingual EN/ID.

### Module & role gating
- **`lib/useModules.ts`** — `useTenantModules()` fetches `GET /modules/me`. **Default-on:** a
  module is hidden only if its flag is explicitly `false`, so a backend hiccup never hides tools.
  Keys (from `@aire/shared`): `analytics, crm, memberships, vouchers, promotions, catalog,
  inventory, finance, hr, ai_assistant, whatsapp`. Core areas (Hub, Overview, Users, Settings,
  Payment Gateway) are always shown.
- **Dashboard nav** is filtered by **module flags** (not by role). **Role gating** is concentrated
  in the **admin** area and a couple of spots (see §5).

---

## 3. Route map

### Public / unauthenticated
| Route | Purpose |
|-------|---------|
| `/` | Login (email/password + one-click demo accounts + public links) |
| `/register` | Business/owner self-signup → `/hub` |
| `/reset-password` | Request reset token, then set new password |
| `/menu/[tenantId]` | Public eMenu (services + plans), no login |
| `/kiosk/[tenantId]` | Public queue-status lookup by order number |
| `/kiosk/[tenantId]/order` | Self-service ordering (device-token authorized) |
| `/portal/[tenantId]` | Customer member portal (WhatsApp-OTP) |
| `/confirm-booking/[token]` | Cashier confirms/rejects a portal booking (unguessable token) |

### Authenticated
| Route group | Purpose |
|-------------|---------|
| `/hub` | Post-login launcher (Dashboard / POS / Kiosk tiles + Platform-Admin tile for super/owner) |
| `/dashboard/*` | Management (see table below) |
| `/pos/[outletAgentId]/*` | Point of sale (tabs: New Order, Orders, Queue, Summary, Shift) |
| `/queue-board/[outletId]` | Full-screen TV queue display |
| `/admin/*` | Platform admin (platform-super-admin only) |

### `/dashboard/*` pages (module-gated)
| Page | What the user does | Module |
|------|--------------------|--------|
| Overview (`/dashboard`) | KPIs, month revenue forecast vs target, AI proposals, quick links | core |
| `transactions` | Charts + orders table (view/edit/void) + Excel/PDF export | analytics |
| `invoices` | List paid orders; print A4 invoice PDF | analytics |
| `reports` | Consolidated metrics + PDF/CSV export | analytics |
| `sales` | Attainment vs target, set target, manage leads | analytics |
| `crm` | All customers (members + non-members) with growth chart; per-row member badge; Edit/Delete. Member management moved to `memberships` → Members | crm |
| `bookings` | Create/edit appointments, confirm/done | crm |
| `memberships` | Tabbed: **Plans** (CRUD), **Members** (list → detail: card, history, renew/suspend), **Cards** (card designer) | memberships |
| `membership-card` | Standalone card designer (same component as the Memberships → Cards tab; no longer in the nav) | memberships |
| `vouchers` | Voucher-pack templates; sell/issue code packs | vouchers |
| `promotions` | CRUD promotions (reward, quota, dates, scope) | promotions |
| `branches` | CRUD outlets | catalog |
| `services` | Service/product menu + per-product recipe/BOM & cost components | catalog |
| `catalog` | Product categories & brands | catalog |
| `payment-methods` | Per-branch POS payment buttons | catalog |
| `kiosks` | Provision kiosk device tokens, copy launch URL, enable/disable | catalog |
| `vehicles` | Vehicle brand/type catalog for POS dropdowns | catalog |
| `inventory` | Stock items, adjust in/out, unit conversions | inventory |
| `procurement` | Suppliers, POs, receive | inventory |
| `opname` | Stock counts → close → reconcile & record variance | inventory |
| `finance` | Revenue/expense/net + forecast, record expenses | finance |
| `cogs` | P&L (revenue − COGS − expenses), product margin, variance | finance |
| `settlement` | Inter-branch owed amounts; settle/payout | finance |
| `hr` | Employees, schedules, leave, holidays, clock in/out | hr |
| `payroll` | Generate/finalize runs, adjustments, loans, CSV payslips | hr |
| `assistant` | Chat with the tenant LLM co-pilot (tool access) | ai_assistant |
| `agents` | AI agent personas + flow routing (built-in vs n8n) | ai_assistant |
| `ai-agent` | Configure the WhatsApp AI agent (connect WAHA/Kapso, prompt, knowledge) | whatsapp |
| `conversations` | Live customer↔AI WhatsApp log (toggle AI, manual reply) | whatsapp |
| `monitoring` | Real-time AI usage (invocations/errors/tokens) | whatsapp |
| `users` | Users (base + custom role, multi-branch), custom roles | core |
| `payment-settings` | Per-tenant payment gateway config | core |
| `settings` | Tenant identity (read-only code), branding, WhatsApp, AI, device discovery | core |

### `/admin/*` pages (platform-super-admin only)
`admin` (overview) · `tenants` (list/create/edit/suspend; rows link by **slug**, e.g.
`/admin/tenants/airin-demo`) · `tenants/[id]` (detail, add branches, toggle modules, **impersonate**;
the `[id]` segment accepts a slug or UUID, resolved server-side) · `monitoring` · `ai-usage` ·
`agent-flows` · `health` (DB/WAHA + Docker container list & logs) · `plans` (subscription plans) ·
`billing` · `config` · `support`. Tenant owners run their business from `/dashboard/*` instead
(branch management is `/dashboard/branches`).

---

## 4. Key UI flows

### POS new order (`/pos/[outletAgentId]/new-order`)
1. **Auth + shift gate** — loads branch context and the current shift. The operating branch is
   fixed by the operator's open shift; no open shift ⇒ an amber banner and Place Order disabled.
2. **Catalog** — services (branch-priced) + payment methods; an AIRE/LEAD business-unit switch
   filters the grid (both share one cart); brand→type datalists.
3. **Order from queue** — a picker (or `?queueId=…` deep link from the Queue tab) prefills
   plate/brand/model/name/phone and carries the `queueEntryId`.
4. **Member detect** — a present plate auto-calls `/members/lookup?plate=`; "Find member" accepts
   a 12-char number, phone, or plate. Member pricing (`membershipId`) attaches **only for a truly
   active membership**; a soft-pop alert covers expiring-soon / grace / revoked / suspended with a
   "Renew now" CTA that starts the renewal in place.
5. **Vouchers** — validated against cart + subtotal; valid codes added as removable chips.
6. **Place order** → `POST /orders` (returns computed totals).
7. **Payment** — method buttons; cash shows change; **dynamic QRIS** renders a QR and polls
   `GET /orders/:id` every 3 s until `paid`; success shows a receipt; state resets for the next
   order.

### Packs on the New Order screen (the retired `/sell-pack` route)
There is no separate Sell Pack page: `PackCatalog` is a second tab of the New Order catalog, and a
selected pack is sent as `membershipPlanId` / `voucherPackTemplateId` on `POST /orders`, so the
wash and the plan settle as **one order and one payment** (migration 089 made a pack an ordinary
`order_items` row). Selling a plan alongside a wash zeroes the `car_wash` lines server-side — the
counter upsell — while the plan line keeps the sale visible in the product mix.

After payment, `runPostPaymentSteps` finishes whatever the pack still needs:
**new membership** → `PlateRegistrationModal` → `POST /memberships/:id/activate` (first plate
pre-filled from the order); **voucher pack** → `POST /voucher-packs/issue` → `VoucherCodesModal`
(codes shown once, WhatsApp delivered); **renewal** → `POST /memberships/apply-renewal`.
Renewal and member management (plates / cancel) are reached from **Find member** in the order
panel.

### Reports (`/dashboard/reports`)
Four tabs sharing one filter bar (date range, business unit, branch): **Reports**
(summary KPIs + shifts), **Daily operations**, **Sales per agent**, and the
**Report Designer**. The two operational tabs rebuild the spreadsheets the
outlet keeps by hand — `GET /reports/daily-operations` (revenue per payment rail
× business unit, then volume / member split / items by category / memberships
new vs renewed by plan length / voucher packs) and `GET /reports/agent-performance`
(item × salesperson matrix). Both pivot whatever keys the API returns rather than
assuming fixed columns, and both export CSV client-side.

### Theme
`ThemeProvider` (contexts/ThemeContext.tsx) resolves: tenant `forced_theme` when
dark mode is disabled, else the visitor's stored choice, else the tenant's
`default_theme`. Only an explicit toggle writes `aire-theme` — reconciling on
mount does NOT, so changing a tenant's default actually reaches existing
visitors. The tenant default is mirrored to `aire-theme-default` for the root
layout's pre-paint script, so a dark-default tenant paints dark on first frame.
`components/shared/ThemeToggle.tsx` is the single toggle used by the login page,
hub, admin shell, dashboard sidebar/header and POS nav.

### Kiosk self-order (`/kiosk/[tenantId]/order`)
Device-authorized (`?kioskToken=` → `x-kiosk-token`). Steps **identify → products → details →
pay → done**: optional identify (plate/phone/number or QR scan) prefills + attaches active
membership pricing + can show the member's card; product grid over the public menu with
out-of-stock items disabled; **Pay now (QRIS)** (poll status) or **Pay at cashier** (drops the car
on the queue unpaid).

### Customer portal (`/portal/[tenantId]`)
WhatsApp-OTP login (token per tenant in localStorage). Tabs: **Home** (membership summary, grace/
revoked renew prompt), **Card** (rendered membership card), **Vouchers**, **Vehicles**, **Menu**,
**History**, **Queue** (live, polled, highlights "You"), **Renew** (QRIS, polls until applied),
**Book** (request appointment → branch confirms via WhatsApp before it joins the queue).

### Dashboard login → hub → nav
Login → session stored → cashier to POS, others to `/hub` → entering `/dashboard` mounts
`BrandingProvider → ThemeGate → DashboardShell`, re-checks auth, loads modules, and renders the
grouped sidebar with module-disabled items filtered out.

---

## 5. Role × module gating (summary)

- **Module flags** gate the **dashboard sidebar only** (default-on).
- **Role gating** (client-side; server RLS/guards are the real enforcement):
  - **Admin panel** — `platform_super_admin` only (tenant owners are redirected to the Hub).
  - **Hub** — Platform-Admin tile only for super-admin.
  - **Memberships → Members** — membership renew/suspend/reactivate buttons require outlet_admin+
    (client-side check; backend guards are the real enforcement). CRM is now customers-only.
  - **POS** — guarded by auth only (no role check); the real gate on ringing up orders is an open
    shift, not a role.
</content>
