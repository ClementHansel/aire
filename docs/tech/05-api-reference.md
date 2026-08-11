# 05 · API Reference

All routes are prefixed **`/api`**. The **Role** column is the *minimum* role (RolesGuard is
hierarchical: `@Roles(OutletAdmin)` also admits owner and super-admin). "Auth" = any authenticated
staff user (JWT, no role gate). "Public" = no auth. "Portal" = customer JWT (`typ:customer`).
"Kiosk" = device token. "Bridge" = per-tenant bridge token.

> This reference is generated from the code trace; paths and guards reflect the controllers as
> written. (The `customer` module's search/profile/analytics routes were hardened on 2026-07-11 —
> they now carry a class-level `JwtAuthGuard + RolesGuard` and are tenant-scoped; see
> [02 · Backend](02-backend.md#2-authentication-roles--multi-tenancy).)

## Auth & identity

| Method · Path | Role | Purpose |
|---|---|---|
| POST `/auth/login` | Public | Email+password → token pair + user |
| POST `/auth/register` | Public | Create tenant + owner, auto-login |
| POST `/auth/forgot-password` | Public | Issue reset token (Redis) |
| POST `/auth/reset-password` | Public | Reset password via token |
| POST `/auth/refresh` | Public | Rotate refresh token → new pair |

## Access / RBAC (`access`)

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/permissions` | OutletAdmin | Permission catalog |
| GET/POST `/roles` · PUT/DELETE `/roles/:id` | TenantOwner | Custom role CRUD |
| GET/POST `/users` · PUT `/users/:id` · PATCH `/users/:id/deactivate` | TenantOwner | User CRUD + multi-branch placement |

## Tenants & outlets

| Method · Path | Role | Purpose |
|---|---|---|
| POST/GET `/tenants` · GET/PUT `/tenants/:id` | PlatformSuperAdmin | Plain tenant CRUD |
| POST/GET `/outlets` · GET/PUT `/outlets/:id` | TenantOwner | Branch CRUD |
| PATCH `/outlets/:id/activate` · `/deactivate` | TenantOwner | Branch activation |

## Platform admin (`admin`)

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/admin/overview` · `/tenants/enriched` · `/tenants/:id/detail` · `/tenants/:id/branches` · `/activity` · `/timeseries` · `/health` · `/ai-usage` · `/monitoring` | SuperAdmin | Platform metrics (`:id` accepts slug or UUID) |
| GET `/admin/health/containers` · `/admin/health/containers/:id/logs` | SuperAdmin | Docker container status + logs (via socket; empty when unmounted) |
| GET `/admin/tenants` | SuperAdmin | List tenants |
| POST `/admin/tenants` · PUT `/admin/tenants/:id` | SuperAdmin | Create/edit tenant |
| GET/PUT `/admin/tenants/:id/modules` | SuperAdmin | Read/toggle per-tenant modules (audited) |
| PATCH `/admin/tenants/:id/suspend` · `/reactivate` | SuperAdmin | Tenant lifecycle |
| POST `/admin/tenants/:id/impersonate` | SuperAdmin | Mint impersonation token (audited) |
| GET/PUT `/admin/config` | SuperAdmin write | Platform config (default plans, feature flags) |
| GET `/admin/platform-plans` · POST · PUT/DELETE `/:id` | GET any admin / writes SuperAdmin | SaaS subscription plans charged to tenants (drives MRR) |
| GET `/admin/audit` · `/admin/audit/filters` | SuperAdmin | Cross-tenant audit log (filters: tenantId/operation/entityType/date, paginated) + distinct filter values |
| GET `/admin/analytics?months=` | SuperAdmin | Growth metrics: snapshot, churn≈, MRR/ARR, signup cohorts + retention (approximated — no status history) |
| GET `/admin/invoices` · `/invoices/summary` · POST `/invoices/generate` · PATCH `/invoices/:id/status` · PUT `/invoices/:id` | SuperAdmin | Platform subscription invoices (real billing ledger). `generate` idempotent per `(tenant, period)`; a background job auto-generates the current month's drafts + flips past-due to overdue (disable via `PLATFORM_INVOICE_AUTOGEN=false`) |
| GET `/admin/platform-users` · POST · PATCH `/:id/active` · POST `/:id/password` | SuperAdmin | Manage platform-super-admin accounts (create/enable/disable/reset-password; can't self-deactivate; audited) |
| POST `/admin/tenants/:id/reset-owner-password` | SuperAdmin | Privileged reset of a tenant owner's password (audited) |
| GET `/admin/announcements` · POST · PUT `/:id` · DELETE `/:id` | SuperAdmin | Platform announcements (audience all/plan/tenant, severity, published, optional window) |
| GET `/admin/tenants/:id/notes` · POST · DELETE `/admin/notes/:id` | SuperAdmin | Internal per-tenant support notes (never shown to the tenant) |
| GET `/announcements/feed` | Auth (any tenant user) | Tenant-facing read of published announcements targeted to the caller's tenant/plan (drives the dashboard banner) |

## Services, catalog, payment methods, vehicles

| Method · Path | Role | Purpose |
|---|---|---|
| POST/GET `/services` · GET/PUT/DELETE `/services/:id` · PATCH `/services/reorder` | Auth | Service/product catalog |
| GET `/services/:id/recipe` · PUT `/services/:id/recipe` | OutletAdmin | Product recipe/BOM + cost components |
| GET/POST `/categories` · PUT/DELETE `/categories/:id` | Auth read / OutletAdmin write | Service categories |
| GET/POST `/brands` · PUT/DELETE `/brands/:id` | Auth read / OutletAdmin write | Product brands |
| GET/POST `/payment-methods` · PUT/DELETE `/payment-methods/:id` | Auth read / OutletAdmin write | Per-branch payment buttons |
| GET/POST `/vehicle-brands` · DELETE `/vehicle-brands/:id` · POST `/vehicle-types` · DELETE `/vehicle-types/:id` | Auth read / OutletAdmin write | Vehicle brand→type catalog |

## Orders & payments

| Method · Path | Role | Purpose |
|---|---|---|
| POST `/orders` | Auth | Create order from POS cart |
| POST `/orders/:id/pay` | Auth | Settle order (cash/QRIS-static/EDC/transfer) |
| GET `/orders` · GET `/orders/:id` | Auth | List / status poll |
| PATCH `/orders/:id` · DELETE `/orders/:id` | OutletAdmin | Edit / cancel (day-locked, restocks) |
| POST `/payments/charge/:orderId` | Auth | Create dynamic-QRIS charge |
| POST `/payments/webhook/{xendit,midtrans,stripe}` | Public | Gateway callbacks (signature-verified) |
| GET/PUT `/payment-config` | OutletAdmin | Per-tenant gateway config (secrets masked) |

## Shifts & queue

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/shifts/current` · `/shifts` · `/shifts/:id` | Auth | Shift reads |
| POST `/shifts/open` · `/shifts/:id/close` · `/shifts/:id/petty-cash` · `/shifts/:id/issues` | Auth | Shift lifecycle |
| GET/POST `/vehicle-queue` · PATCH status | Auth | Arrival board (add car / set service status; `done` requires paid order) |

## Inventory / COGS / procurement / finance

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/inventory/summary` · `/items` · `/items/:id` · POST `/items` · POST `/items/:id/adjust` | Auth | Stock items + movements |
| GET/POST `/inventory/:id/uom` · DELETE `/uom/:id` | OutletAdmin | Unit conversions |
| GET/POST `/cost-component-types` · DELETE `/cost-component-types/:id` | OutletAdmin | Non-physical cost types |
| GET `/opname` · POST `/opname` · GET `/opname/:id` · PATCH `/opname/:id/items/:itemId` · POST `/opname/:id/close` | OutletAdmin | Stock opname → reconcile |
| GET `/cogs/pnl` · `/cogs/product-margin` · `/cogs/inventory-variance` | OutletAdmin | COGS P&L / margin / variance |
| GET `/procurement/summary` · `/suppliers` · POST `/suppliers` · GET/POST `/purchase-orders` · POST `/purchase-orders/:id/receive` | Auth | Procurement + auto-restock on receive |
| GET `/finance/summary` · GET/POST `/finance/expenses` | Auth | Revenue − expenses, expenses |

## Reports & sales

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/reports/summary` · `/revenue-series` · `/customer-growth` · `/daily-sales` · `/shifts` · `/export` | Auth | Reporting + CSV/PDF export |
| GET `/sales/summary` · `/sales/leads` · POST `/sales/leads` · PATCH `/sales/leads/:id/status` · POST `/sales/targets` | Auth | Sales attainment/forecast + leads + targets |

## HR & payroll

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/hr/summary` · `/hr/my/branch-context` · GET/POST `/hr/employees` · PATCH `/hr/employees/:id/link-user` · POST `/hr/employees/:id/{attendance,clock-in,clock-out}` | Auth | Employees + attendance |
| GET/POST `/hr/schedules` · `/hr/holidays` · `/hr/leave` · PATCH `/hr/leave/:id` | Auth | Schedules, holidays, leave |
| GET/POST `/payroll/adjustments` · `/payroll/loans` · POST `/payroll/loans/:id/repay` | Auth | Adjustments + loans |
| GET `/payroll/runs` · `/payroll/runs/:id` · POST `/payroll/generate` · `/payroll/runs/:id/finalize` · GET `/payroll/runs/:id/export` | Auth | Payroll runs + CSV payslips |

## Membership & customers

| Method · Path | Role | Purpose |
|---|---|---|
| POST/GET `/membership-plans` · GET/PUT/DELETE `/membership-plans/:id` | Auth | Membership plans |
| POST `/memberships/sell` · POST `/memberships/:id/activate` | Auth | Sell → activate (register plates) |
| POST `/memberships/:id/renew` · POST `/memberships/apply-renewal` | Auth | Renewal (fee order → apply after paid) |
| POST `/memberships/backfill-numbers` | OutletAdmin | Backfill membership numbers |
| GET `/memberships/manage` · GET `/memberships/:id/events` | Auth | CRM list + event history |
| PATCH `/memberships/:id/suspend` · `/reactivate` | OutletAdmin | Manual suspend/reactivate |
| GET `/members/lookup?number\|phone\|plate` | Auth | Resolve member (POS/kiosk) |
| GET/PUT `/membership-card` · PUT/DELETE `/membership-card/background` | Auth read / OutletAdmin write | Card designer |
| GET `/public/card-template` · `/public/card-template/background` | Public | Card template + bg stream |
| GET `/customers/list` · PUT `/customers/:id` | OutletAdmin | CRM list / edit |
| DELETE `/customers/:id` | TenantOwner | Delete customer |
| GET `/customers` · `/customers/:id/profile` · `/customers/:id/analytics` | OutletAdmin | Search / profile / analytics (tenant-scoped) |

## Vouchers & promotions

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/voucher-packs/catalog` · POST `/voucher-packs/sell` · POST `/voucher-packs/issue` | Auth | Sell + issue packs |
| GET/POST `/voucher-templates` · PUT/DELETE `/voucher-templates/:id` | Auth | Pack templates |
| POST `/vouchers/validate` | Auth | Validate a child code against cart |
| POST `/voucher-tickets/sell` · GET `/validate` · POST `/redeem` · GET `/books` · `/books/:id/tickets` | Auth | Shareable digital vouchers |
| GET/POST `/promotions` · PUT/DELETE `/promotions/:id` | Auth read / OutletAdmin write | Promotions |

## Bookings & settlement

| Method · Path | Role | Purpose |
|---|---|---|
| GET/POST `/bookings` · PUT/DELETE `/bookings/:id` | Auth | Staff bookings |
| GET `/settlement/summary` · `/entries` · `/payouts` · POST `/settlement/payout` | TenantOwner | Inter-branch settlement |

## Kiosk (device token) & public menu

| Method · Path | Auth | Purpose |
|---|---|---|
| GET `/kiosk/menu` · `/kiosk/queue-status` · POST `/kiosk/join-queue` | Public | eMenu, queue lookup, join queue |
| GET `/kiosk/vehicle-brands` · `/kiosk/identify` · POST `/kiosk/orders` · `/kiosk/orders/:id/charge` · GET `/kiosk/orders/:id/status` | Kiosk token | Self-order + pay |
| GET/POST `/kiosk-devices` · PATCH `/kiosk-devices/:id/active` | OutletAdmin | Provision kiosks |

## Customer portal

| Method · Path | Auth | Purpose |
|---|---|---|
| POST `/portal/otp/request` · `/portal/otp/verify` | Public | WhatsApp-OTP login |
| GET `/portal/me` · `/portal/orders` · `/portal/branches` · `/portal/queue` · `/portal/plans` | Portal | Account, history, branches, live queue, plans |
| POST `/portal/renew` · GET `/portal/renew/status` | Portal | Online QRIS renewal |
| POST/GET `/portal/bookings` | Portal | Request/list bookings |
| GET `/public/bookings/:token` · POST `/public/bookings/:token/{confirm,reject}` | Public (token) | Cashier confirm/reject link |

## AI, WhatsApp & bridge

| Method · Path | Role | Purpose |
|---|---|---|
| GET `/agent/tools` | Public | Tool catalog |
| POST `/agent/chat` · GET/POST `/agent/chat/sessions` · GET/PATCH/DELETE `/agent/chat/sessions/:id` · POST `/agent/validate-connection` · GET `/agent/monitoring/{summary,recent,events}` | Auth | Co-pilot chat, thread history (rename/pin/archive) + monitoring |
| POST `/admin/ai/chat` · GET/POST `/admin/ai/chat/sessions` · GET/PATCH/DELETE `/admin/ai/chat/sessions/:id` · GET `/admin/ai/chat/tools` | SuperAdmin | Platform AI console (cross-tenant, READ-ONLY tools) |
| GET `/agent/:tenantId/proposals` · POST `…/proposals/:id/{approve,reject}` | TenantOwner | AI action proposals |
| GET/PUT `/agent-config` | TenantOwner | WhatsApp/AI agent config |
| GET/POST `/agents` · PUT/DELETE `/agents/:id` | TenantOwner | Agent personas |
| GET/PUT `/branding` · PUT/DELETE `/branding/logo` · GET `/branding/me` | Auth read / TenantOwner write | Branding |
| GET `/public/branding` · `/public/branding/logo` | Public | Public branding (default on unknown tenant) |
| POST `/whatsapp/webhook` | Public | WAHA/Kapso inbound webhook |
| GET `/whatsapp/status` · POST `/whatsapp/connect` · GET `/whatsapp/qr` · conversations endpoints · POST `/whatsapp/simulate-inbound` | TenantOwner | WhatsApp connect + conversation log |
| GET/POST `/whatsapp/whitelist` · PATCH/DELETE `/whatsapp/whitelist/:id` | TenantOwner | Staff numbers routed to the FULL business agent (`accessLevel` full/read_only) |
| GET/POST/PUT/PATCH/DELETE `/agent-flows[/:id]` | SuperAdmin | n8n flow catalog |
| GET/PUT `/agent-flow-selection` · GET `/agent-flow-selection/available` · POST `/agent-flow-selection/token` | TenantOwner | Tenant flow selection + bridge token |
| POST `/bridge/{context,llm,tool,whatsapp/send}` | Bridge token | n8n callback surface |

## Config, invoices, bays, audit

| Method · Path | Role | Purpose |
|---|---|---|
| GET/PATCH `/settings/:tenantId` | TenantOwner | Automation settings (secrets encrypted) |
| GET `/modules/me` | Auth | Enabled-module map |
| POST/GET `/invoices` · GET/PUT/DELETE `/invoices/:id` · GET `/invoices/:id/pdf` · GET/PUT `/receipt-templates` | Auth | Invoices + receipt template |
| GET `/bays` · `/bays/:id` · POST `/bays/:id/{assign,gate-open}` · PATCH `/bays/:id/status` | Auth | Wash-bay control |
| GET `/audit-logs` | Auth | Tenant-scoped audit trail |
| GET `/discovery/:tenantId/*` · GET `/cctv/*` | TenantOwner / Auth | Device discovery / CCTV (partly stubbed) |
</content>
