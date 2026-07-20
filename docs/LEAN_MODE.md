# Lean Mode — what is hidden/disabled and how to restore

**Status:** ON (`LEAN_MODE = true`). Added 2026-07-20 for early client testing.

Lean mode pares the tenant product back to the **original Aire POS PRD core** so a
client can try a simple operational flow without wandering into half-configured,
post-PRD features. Nothing is deleted — everything is gated behind a single flag
and is restored by flipping it off.

## The master switch

`packages/shared/src/modules.ts`

```ts
export const LEAN_MODE = true;          // ← flip to false to restore the full product
export const HELD_NAV_IDS: string[]     // dashboard nav item ids hidden while lean
export const HELD_ROUTE_PREFIXES: string[]  // dashboard routes blocked from direct URL
export function isHeld(id): boolean          // LEAN_MODE && HELD_NAV_IDS.includes(id)
export function isHeldRoute(path): boolean   // LEAN_MODE && prefix match
```

Backend mirror: `apps/backend/src/common/lean.ts`
- `leanModeEnabled()` — reads `LEAN_MODE`; honors `LEAN_MODE=false` env override (used by tests).
- `assertNotLean(feature)` — throws `403` when lean; used inline in a couple of handlers.
- `LeanDisabledGuard(feature)` (`common/guards/lean.guard.ts`) — controller/route guard; a no-op when lean is off.

## What stays visible (PRD core)

Overview · Transactions · Refunds · Reports · Sales & Leads · Customers & CRM ·
Memberships · Vouchers & Promotions · Branches · Services · Products ·
Categories & Brands · Payment Methods · WhatsApp (slimmed) · Conversations ·
Users & Roles · Billing · Settings · Help & Docs.

## What is HIDDEN (navigation + direct-URL blocked)

Filtered out of the sidebar in `apps/frontend/src/app/dashboard/layout.tsx`
(`!isHeld(item.id)`), and a guard in the same file redirects a **non-super-admin**
off any held route to `/dashboard`. **Super-admins bypass the guard** (they can
still inspect held surfaces).

Held nav ids / routes (`HELD_NAV_IDS` / `HELD_ROUTE_PREFIXES`):

| Area | Held items |
|------|-----------|
| Analytics | `invoices`, `shifts` |
| Customers | `bookings`, `feedback`, `broadcast` |
| Catalog & Outlets | `legal-entities`, `kiosks`, `pos-devices`, `barcode-settings`, `vehicles` |
| Operations | `inventory`, `procurement`, `opname`, `cctv`, `topology`, `devices` (whole section) |
| Finance & People | `finance-setup`, `finance`, `accounting`, `pnl`, `cogs`, `settlement`, `tax-invoices`, `hr`, `payroll`, `commission` (whole section) |
| AI | `assistant`, `agents` (n8n), `monitoring` |
| Administration | `audit` |

## What is DISABLED (hidden AND backend-neutralized)

These are interlinked customer/employee surfaces that would break or confuse a
client trial, so both the UI route and the API are turned off. **Reversible** —
the API guards no-op when `LEAN_MODE` is off.

| Surface | Frontend | Backend |
|---------|----------|---------|
| Customer self-order | `app/kiosk/[tenantId]/order/page.tsx` redirects to the kiosk status page | `kiosk.controller.ts` `createOrder` / `charge` → `assertNotLean` (menu/queue reads stay live) |
| Employee self-service | `app/employee/page.tsx` redirects to `/hub` | whole `me.controller.ts` behind `LeanDisabledGuard` |
| Customer portal | `app/portal/[tenantId]/page.tsx` redirects to `/` | `PortalController` behind `LeanDisabledGuard` |

**Kept live on purpose:** `PortalBookingService` (the WhatsApp agent's
`create_booking` calls it directly — NOT the HTTP route) and
`PublicBookingController` (`/api/public/bookings/:token`, the WhatsApp
booking confirm/reject links).

## Related behavior changes (part of the same batch)

- **Cashier → POS on login.** `app/page.tsx` routes a `cashier` straight to
  `/pos/{outletId}/new-order`; the POS layout guard
  (`app/pos/[outletAgentId]/layout.tsx`) lets an authenticated cashier in with no
  device token (branch resolved from the session). The registered-terminal flow is
  preserved for shared devices. The `/employee` dashboard is no longer a login
  destination.
- **Onboarding trimmed** to Branch → Service → Staff → Done. Legal-entity and
  finance steps were removed. Backend `onboarding.service.ts`
  `mandatoryComplete = branch>0 && service>0` (legal no longer required;
  `outlets.legal_entity_id` is nullable so branches create fine without one).
- **AI config moved to super-admin.** Tenants can no longer set the AI key /
  model / daily-limit / prompts. Configure per tenant at
  **`/admin/tenants/{id}` → AI Configuration** (`GET/PUT /api/admin/tenants/:id/ai-config`).
  The tenant `/dashboard/ai-agent` page ("WhatsApp") is slimmed to just the
  WhatsApp connection (QR/number/per-branch/mock) + an AI auto-reply pause. This is
  **not** gated by `LEAN_MODE` — it is a permanent ownership change.
- **WhatsApp agent additions** (also permanent, not `LEAN_MODE`-gated): auto
  thank-you + voucher codes on purchase, auto thank-you + public receipt link on
  payment (`/receipt/[token]`), Q&A tools for branch location/hours and voucher
  balance/codes, `skills` now injected into the agent prompt, default Bahasa prompts.

## How to restore the full product

1. Set `LEAN_MODE = false` in `packages/shared/src/modules.ts`.
2. Rebuild `@aire/shared` and both apps (`pnpm --filter @aire/shared build`, then rebuild backend + frontend).

That single flag restores all hidden nav, unblocks all held routes, and re-enables
the self-order / employee / portal APIs. The AI-config-ownership and WhatsApp-agent
changes above are intentional and stay regardless of the flag. To re-expose the AI
config to tenants you would revert the agent-config lockdown separately.

## Migrations shipped with this batch

Run on deploy (additive, safe):
- `073_outlet_opening_hours.sql` — `outlets.opening_hours JSONB` (agent branch hours).
- `074_agent_default_prompts.sql` — seeds Bahasa default base_prompt/skills/product_knowledge on `agent_configs` (+ backfills NULL rows).
- `075_orders_public_token.sql` — `orders.public_token` for the public receipt link.
