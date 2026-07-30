# 06 · Membership — End-to-End Flow & Cycle

This is the definitive description of how a membership is born, used, expires, and is renewed —
from the sales counter through daily life to the customer's own portal. It ties together the
`membership`, `membership-card`, `order`, `payment`, `settlement`, `portal`, and `kiosk` modules.

---

## 1. The status cycle

A membership moves through a small, strict set of statuses. Two of them (`suspended`,
`cancelled`) are **manual** and date-independent; the rest are **date-driven**.

```
                 sell                 activate (+plates, +payment)
   (none) ─────────────► pending ──────────────────────────────► active
                                                                    │
                              end_date passes                       │
                                                                    ▼
                                                      grace  (H+1 … H+14, renewable,
                                                              NO benefits)
                                                                    │
                              H+15 (past grace window)              │
                                                                    ▼
                                                      revoked (terminal — must buy new)

   active ──(admin block)──► suspended ──(admin)──► active
   active/pending ──(admin)──► cancelled  (terminal)
```

| Status | Meaning | Benefits? | Renewable? |
|--------|---------|-----------|-----------|
| `pending` | Sold but not yet activated/paid | No | — |
| `active` | Within the paid period (`today ≤ end_date`), not suspended | **Yes** | Yes (extend) |
| `grace` | Paid period ended, within **H+1 … H+14** | **No** | Yes (extend) |
| `revoked` | Past **H+14** (i.e. H+15+) — terminal | No | No — new membership required |
| `suspended` | Manual block by outlet-admin+ (rule breach), still within paid duration | No | On reactivate |
| `cancelled` | Manual/terminal | No | No |
| `expired` | Legacy label; the live engine emits grace/revoked, never "expired" | No | — |

`MEMBERSHIP_GRACE_DAYS = 14` (in `@aire/shared`). "H" = the day after `end_date`.

### Two mechanisms keep status correct (and they agree)
1. **Read-time truth** — `MembershipLifecycleService.derive(storedStatus, endDate, now)` is called
   on every read path (member lookup, CRM list, kiosk identify, portal `me`). Manual statuses
   (`pending`/`cancelled`/`suspended`) pass through unchanged; otherwise it computes
   `active`/`grace`/`revoked` purely from dates. So a row still stored `active` past its end date
   never *displays* as active.
2. **Write-time job** — `runTransitions()` runs at boot and every **6 hours** (a plain
   `setInterval`, no `@nestjs/schedule`, `.unref()`-ed, guarded against overlap). It writes
   `active → grace` and `active/grace → revoked` for date-crossed rows, sets `grace_until` /
   `revoked_at`, and appends `membership_events` (`entered_grace`, `revoked`).

### The hard benefit guard
Regardless of the stored status label, benefits are granted **only** when
`status = 'active' AND end_date >= CURRENT_DATE` (`OrderService.getMembershipBenefits`). This is
the single gate that makes a stale/grace/revoked/suspended membership grant nothing at POS — even
in the gap between transition-job runs.

### Event history
Every meaningful transition appends a `membership_events` row (`activated`, `renewed`,
`entered_grace`, `revoked`, `suspended`, `reactivated`, `cancelled`, `payment`, `usage`) with an
`actor` and a JSON payload. The CRM "History" modal and the portal both read from it.

---

## 2. Selling a membership

Since 2026-07-30 the POS sells a plan from the **New Order → Membership & Vouchers** tab, on the
same order as the wash. `POST /api/orders` takes `membershipPlanId` and, in one transaction, adds
a `membership_plan` line (migration 089), creates the **`status='pending'`** membership snapshotting
the plan's `max_uses` / `daily_limit` against that `order_id`, and points the order at it. Only
**one membership plan per order** is allowed.

**Counter upsell:** when the same order also has `car_wash` lines, those lines are zeroed and
flagged as member pricing, so the customer's wash that day is free and payment consumes one usage.
The order is tagged `new_member` (plus `member`), which is what makes the upsell legible in reports.

`POST /api/memberships/sell` still exists for callers that mint their own fee order (CRM, portal):

1. **`POST /api/memberships/sell`** — in one transaction: upsert the customer, create a **pending
   fee order** for the plan price (tagged `Membership: <plan>`), and insert a
   **`status='pending'`** membership snapshotting the plan's `max_uses` / `daily_limit`, tied to
   that `order_id`. Returns `{ order, membershipId, maxPlates, planName }`.
2. **Pay** the fee order through the normal POS payment flow (cash / QRIS / EDC / transfer).
3. **`POST /api/memberships/:id/activate`** — requires **at least one vehicle plate** (up to the
   plan's `max_plates`, default 3). It sets `start_date = today`,
   `end_date = today + duration_months`, `status = 'active'`, registers the plates (normalized),
   **issues the membership number** (see §5), schedules expiry reminders, and emits
   `MembershipActivated`.

> Plans have durations restricted to 1, 3, 6, or 12 months and carry `free_service_ids` (e.g. a daily
> free wash), `discounted_services`, `max_plates`, `daily_limit`, `settlement_amount`, and an
> optional WhatsApp welcome.

---

## 3. Everyday use — how benefits apply on an order

When an order carries a `membershipId` (attached by POS "Find member", kiosk identify, or queue
prefill — **only if the membership is genuinely active**):

1. `getMembershipBenefits(membershipId)` runs the hard guard (`active` + `end_date >= today`).
   Grace/revoked/suspended/expired → no benefits, no `membershipId` attached.
2. If active, the plan's `free_service_ids` and `discounted_services` rewrite the cart line
   discounts (`applyMembershipPricing`), and the order captures the membership's `home_outlet_id`
   and the plan's `settlement_amount`.
3. On order commit: a `membership_usages` row is written and `uses_count` is incremented (subject
   to `max_uses` / `daily_limit`).
4. **Cross-branch settlement:** if the wash was redeemed at a branch other than the member's
   `home_outlet_id` and `settlement_amount > 0`, a `settlement_entries` row is written (home
   branch owes serving branch). The `settlement` module later nets and pays these out
   (`settlement_payouts`).

The **member card** (designed in `/dashboard/membership-card`) renders the member's number as
plain text, a barcode, or a QR (`idType`), over a background stored in MinIO. It's shown in the
kiosk "welcome back", the CRM history modal, and the customer portal. Hardware keyboard-wedge
scanners work by typing the 12-char number into POS "Find member".

---

## 4. Expiry → grace → revoked, and renewal

### The window
- On `end_date`, the membership is still active through end-of-day.
- **H+1 … H+14** it is `grace`: still visible, **no benefits**, but **renewable by extension**.
- **H+15+** it is `revoked`: terminal; the customer must buy a **new** membership.

### Renewal is two-phase (payment-safe)
1. **Start** — `POST /api/memberships/:id/renew` (or the portal's online path) creates a **renewal
   fee order** and a **pending `membership_renewals`** row `(order_id UNIQUE, membership_id,
   plan_id, applied=false)`. **The membership is NOT extended yet.**
2. **Pay** the fee order.
3. **Apply** — `POST /api/memberships/apply-renewal { orderId }` verifies the order is paid, then:
   - **Extend** if a membership with the **same plan** is `active` or `grace`:
     `new end_date = existing end_date + duration_months` (extends from current expiry, not today),
     status back to `active`, clears `grace_until`/`revoked_at`. → **grace memberships extend.**
   - **New parallel** otherwise — different plan, or a **revoked/absent** membership (revoked is
     past the renewable window): a brand-new `active` membership from today.
   - Marks the renewal `applied=true`. Idempotent (re-applying is a no-op). Records a `renewed`
     event.

This two-phase design means an unpaid renewal never silently extends a membership; the extension
only happens once money is confirmed.

### Where renewal is initiated
- **POS New Order → Find member → Renew & pay** — look up by plate/phone/number → pick the plan →
  renew → pay → apply.
- **CRM → Renew** modal — same, with in-modal payment collection.
- **Customer portal → Renew** — online: `POST /portal/renew` creates the fee order + a **QRIS**
  charge; the app polls `/portal/renew/status` and applies the renewal once the charge is paid.
  (It reuses the staff renewal machinery via a synthesized per-tenant system operator so the fee
  order has a valid creator/branch.)

---

## 5. Membership identity (the 12-char number)

Every member gets a stable **12-character base-36** number:

```
  TTTTTT      BB       CCCC
  tenant   branch   customer
 (global) (per-    (per-branch)
          tenant)
```

- `tenant_code` (6) is globally unique, assigned at tenant creation (`MAX+1`, retry-on-race).
- `branch_code` (2) is unique per tenant.
- `customer_code` (4) is unique per `(tenant, registered branch)`.

Allocation is **lazy** (at first activation) and **reused** across renewals — a customer keeps
their number for life. Fixed-width zero-padding makes lexical order equal numeric order, so
"next code" is just `MAX(code)+1`. `backfill-numbers` assigns numbers to pre-identity members.
Lookup by number powers POS "Find member", kiosk identify, and scanners.

---

## 6. The full lifecycle at a glance (customer journey)

1. **Buy** — customer buys a plan at the counter (or a cashier sells it). Fee order paid, plates
   registered, membership **active**, number issued, welcome sent.
2. **Use** — each visit: staff or kiosk identifies the member (plate / phone / number / card
   scan); active benefits apply (free/discounted services); usage + quota tracked; cross-branch
   washes accrue settlement.
3. **Self-serve** — the customer logs into the **portal** with a WhatsApp OTP to see their card,
   status, vehicles, vouchers, visit history, live branch queue, and to **book** or **renew**.
4. **Lapse** — at `end_date` the membership enters **grace** (renewable, no benefits) for 14 days,
   then **revoked**. The transition job + read-time derive keep the status honest; the benefit
   guard ensures no free washes leak during grace/after revoke.
5. **Renew** — during active/grace the customer (portal) or staff (POS/CRM) renews by extension
   (pay → apply). After revoke, they buy a new membership. Either way the number and history carry
   forward.
</content>
