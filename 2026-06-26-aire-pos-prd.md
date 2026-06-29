# PRD: AIRE POS — Platform Kasir Car Wash (SaaS Multi-Outlet)

| Field | Value |
|-------|-------|
| **Produk** | AIRE POS (bagian dari AIRIN Platform) |
| **Versi** | 1.0 |
| **Tanggal** | 26 Juni 2026 |
| **Status** | Draft |
| **Pilot** | AIRE Kencana Loka |
| **Sumber** | AIRE Cashier Handbook Kencana Loka v1.0 |
| **Scope** | Multi-outlet, SaaS-ready |

---

## 1. Ringkasan Produk

### 1.1 Visi

AIRE POS adalah sistem kasir berbasis web (PWA) untuk layanan car wash, dirancang sebagai platform SaaS multi-tenant yang mendukung multiple outlet dalam satu bisnis. Sistem memungkinkan kasir menjalankan transaksi harian — dari order cuci, membership, voucher, hingga campaign — sementara owner/admin mengelola seluruh outlet dari dashboard terpusat.

### 1.2 Arsitektur Multi-Tenant

| Konsep | Deskripsi |
|--------|-----------|
| **Tenant** | Satu bisnis (misal: "AIRE Car Wash"). Memiliki multiple outlet. |
| **Outlet** | Cabang fisik dari tenant (misal: Kencana Loka, Cabang B, Cabang C). |
| **Pilot** | Tenant pertama = AIRE, outlet pertama = Kencana Loka. |
| **Scaling** | Tenant baru bisa onboarding tanpa perubahan arsitektur. |

### 1.3 Role Hierarchy

| Role | Scope | Akses |
|------|-------|-------|
| **Platform Admin** | Semua tenant | Super admin SaaS platform |
| **Business Owner** | Semua outlet dalam tenant | Full access: pricing, config, orders, reports, membership plans |
| **Outlet Admin** | 1 outlet spesifik | Manage outlet own: orders, void approval, local config |
| **Cashier** | 1 outlet spesifik | POS only: new order, orders (own outlet), summary, receipt |

### 1.4 Service Profile

POS berjalan dalam **Service Profile** (car wash mode):
- Customer fields: Nama, Phone, License Plate, Brand, Model
- Phone = primary lookup key (membership, loyalty, voucher)
- License Plate = backup lookup key
- Tidak ada table picker (berbeda dari F&B profile)

### 1.5 Key Constraints

- Transaksi harus ada **main service** (tidak bisa add-on only)
- Setiap order di-stamp dengan nama operator (kasir)
- Data scoped ke tenant + outlet sesuai role

---

## 2. POS Core

### 2.1 Login & Authentication

- Login via email + password di `dashboard.useairin.com`
- Post-login: redirect ke POS outlet (`…/pos/<outlet-agent-id>`)
- PWA installable — "Add to Home Screen" untuk tablet
- Session persistent, auto-refresh

### 2.2 New Order Flow

```
Menu Grid → Cart → Customer Info → Check (lookup) → Voucher (opt) → Payment Method → Place Order → Payment Window → Confirm → Cart Reset
```

**Step detail:**

1. Tap service tile di menu grid → masuk cart
2. Isi customer info: Name*, Phone*, License Plate (recommended), Brand (optional), Model (optional)
3. Tap **Check** → lookup customer/member di database
   - Auto-fill name, phone, plate, brand, model jika found
   - Show membership banner (plan, expiry, plates, free/discounted services)
   - Auto-apply member pricing ke cart
4. Adjust quantity (+/−)
5. Apply voucher (optional) — expand voucher section, input code, Apply
6. Pick payment method
7. Add note (optional)
8. Tap **Place Order** → validation check → payment window open
9. Confirm payment → order PAID → cart reset

### 2.3 Menu Grid

- **Category tabs:** All, Car Wash, Product, add-on (dengan item count)
- **Tile content:** service name + price
- **Special labels:**
  - `GRATIS` (green) — free untuk member ini
  - `−20%` (atau sejenis) — member discount
  - `Habis` — sold out, tile disabled
  - Badge number = qty sudah di cart
- Tap tile = add to cart. Tap lagi = add another.
- Custom/unlisted item → communicate ke Admin/Owner untuk input dari dashboard.

### 2.4 Cart

**Line items:**
- Qty +/−, item name, unit price, line subtotal, delete (trash)
- Member badge: `MEMBER GRATIS` / `MEMBER −20%` (saat membership pricing applied)
- Manual discount field (capped oleh owner config, tidak bisa exceed)

**Customer section:**
- Name, Phone, License Plate, Brand, Model

**Payment section:**
- Payment method selected

**Voucher section:**
- Voucher info badge (saat applied)

**Note section:**
- Free text (e.g. "extra dirty, customer waiting")

**Summary:**
```
Subtotal
+ Service Charge (if any)
+ Tax / PPN (if any)
− Voucher Discount(s)
− Promo / Campaign Discount(s)
─────────────────────────
TOTAL
```

### 2.5 Payment Methods

| Method | Flow |
|--------|------|
| **Cash** | Type amount received / quick-tender button ("Exact", Rp 150.000, Rp 200.000). Change auto-calculated (green). Confirm Payment → PAID. |
| **QRIS Static** | Show QR. Customer scan + pay. Kasir lihat merchant account → tap "Tandai Sudah Bayar" → PAID. |
| **QRIS Dynamic (Xendit)** | Show QR. Auto PAID saat payment confirmed. Window auto-close. |
| **EDC** | Run card di EDC machine. Input reference number (trace/slip). Confirm → PAID. |
| **Transfer** | Customer transfer. Input reference (last 4 digits / transfer ref). Confirm → PAID. |

### 2.6 Validation (Pre Place Order)

| Check | Rule |
|-------|------|
| Name | Required, tidak boleh kosong |
| Phone | Required, minimum 8 digit |
| Cart | Tidak boleh kosong |
| Main service | Minimal 1 main service di cart (bukan add-on only) |
| Voucher minimum | Minimum order amount terpenuhi |
| Member plate | Jika member punya multiple plates → pilih plate yang match |

Jika gagal → order rejected dengan pesan error spesifik.

### 2.7 Receipt Printing

- **Koneksi:** Bluetooth printer, connect sekali per shift (tap Printer icon → pilih device)
- **Konten:** Store name, order number, date/time, items, charges/tax, discounts, total, payment method, custom header/footer (e.g. "Terima kasih!")
- **Reprint:** Dari Orders tab, receipt icon di order card
- **Troubleshoot:** Print fail → reconnect Bluetooth

---

## 3. Membership

### 3.1 Plan Structure

- **Durasi:** 1 bulan / 3 bulan / 12 bulan (configurable per tenant)
- **Quota:** lifetime cap + daily/period limit
- **Plates:** max 3 license plates per membership account (configurable)
- **Benefits:** free washes + discounted washes per plan
- **Scope:** applicable ke all / selected outlets dalam tenant

### 3.2 Member Lookup

**Input:** Phone (best) atau License Plate

**Tap Check:**
- **Phone matching:** normalisasi 62…, 0…, +62… variants
- **Plate matching:** normalisasi (spaces removed, uppercase: `B 1234 ABC` → `B1234ABC`)
- **Cross-outlet:** member bisa lookup di semua outlet tenant yang sama

**Result (jika found):**
- Auto-fill: name, phone, plate, brand, model
- Membership banner: plan name, expiry date, registered plates, free/discounted services
- Auto-apply member pricing ke cart saat service ditambahkan
- Member badge muncul di cart

**Multiple active plans:** Jika customer punya >1 plan aktif (e.g. 1-month + 3-months), POS aware — pastikan plan yang tepat applied untuk service yang dijual.

### 3.3 Quota System

- **Usage recording:** Setiap order PAID yang menggunakan benefit membership → 1 usage tercatat per license plate
- **Tracking:** per plate (report bisa show "B1234ABC washed 5×")
- **Daily limit:** Max N washes per day (default 1, configurable). Over limit = normal price. Banner warning: same-plate same-day reuse.
- **Lifetime quota:** Total usage cap. Reached → membership flip EXPIRED otomatis.
- **Reset:** Daily counter reset 00:00 WIB.

### 3.4 Sell New Membership (Sell Pack)

**Flow:**
1. Tap **Sell Pack** (top-right)
2. Pilih plan dari Memberships section (duration, max uses, price)
3. Add to cart
4. Isi customer name + phone (membership created against this phone)
5. **Upgrade credit (jika ada wash di cart):** Plan price dikurangi cart wash value. Customer "upgrade" walk-in wash ke membership. Net price = yang di-charge.
6. Max 1 plan per order.
7. Place Order → Payment → Confirm

**Post-payment — Vehicle Registration:**
- Window auto-open
- Start date = today
- Pre-fill plate/brand/model dari order
- Add up to 3 plates
- Save → membership active, tied to vehicles

**Post-activation:**
- WhatsApp welcome message (if enabled di plan)
- Expiry reminders auto-scheduled: H-30, H-7, H-day

### 3.5 Renewal

- **Same plan:** Extend end date (keep original start date for tenure). Reschedule reminders. No duplicate.
- **Different plan:** New independent membership, run parallel (own quota, own reminders).

### 3.6 Edit Plates

- Member bisa tambah/ubah plate (max 3, configurable per plan)
- Dari member detail (via lookup) → Edit/Add → vehicle registration window
- Plate changes: audit-logged (who, what, when)
- Freed plate dari cancelled/expired membership → bisa re-register

### 3.7 Error States

| Condition | Why | Action |
|-----------|-----|--------|
| "Membership expired" | Past end date atau lifetime quota used up | Offer renewal (Sell Pack). Charge normal meanwhile. |
| No benefit, banner same-day reuse | Daily/period limit hit | Charge normal. Explain reset midnight. |
| Member found, full price | Wrong brand/outlet, atau forgot tap Check | Tap Check. Confirm plan covers outlet + service. |
| "Not yet active" / PENDING | Start date future (advance sale) | Charge normal until start date. |

---

## 4. Voucher

### 4.1 Types

| Type | Deskripsi | Contoh |
|------|-----------|--------|
| **FIXED** | Flat amount discount | Rp 25.000 off |
| **PERCENTAGE** | Percentage discount | 20% off |
| **SERVICE_PACK** | Prepaid bundle, redeemed per use | "10× Cuci Mobil" |

### 4.2 Redemption Rules

- **Stack max:** 1 FIXED + 1 PERCENTAGE + 1 SERVICE_PACK (per transaksi)
- **1 voucher = 1 transaksi** (tidak bisa split across orders)
- **Badge status:**
  - 🔵 **Blue** = valid, discount applied (terlihat di cart summary)
  - 🟠 **Orange** = code valid tapi tidak apply (wrong brand/outlet/service, atau minimum not met). Discount zeroed + warning shown.

### 4.3 Golden Rule: Voucher + Membership

**Voucher wins.** Jika voucher applied dalam transaksi, membership quota **TIDAK** terpakai. Customer hanya di-charge sekali, membership quota tetap utuh.

Rasional: Customer tidak pernah "bayar dua kali" untuk satu cuci.

### 4.4 Parent vs Child Codes (SERVICE_PACK)

- Multi-use pack = 1 **parent code** (pack identity) + N **child codes** (single-use each)
- Customer harus present **child code**, bukan parent
- Parent code rejected: *"This is a voucher pack — present one of its individual codes"*
- Each child = single-use. Redeeming child = tick up pack overall count (reporting).

**Code generation:**
- Parent code: unique alphanumeric, prefixed tenant identifier (e.g. `AIRE-PK-XXXX`)
- Child codes: unique alphanumeric, linked to parent (e.g. `AIRE-C-XXXX-01`, `AIRE-C-XXXX-02`)
- Generated at payment confirmation (post-payment, not pre-purchase)
- Collision-resistant: random generation + uniqueness check di database
- Stored hashed di database, displayed plain-text ke customer via WhatsApp

### 4.5 Sell Voucher Pack (Sell Pack)

**Flow:**
1. Tap **Sell Pack** → Service Packs section
2. Pilih template (uses, included services, validity, price)
3. Fill customer phone + name
4. Payment → Confirm

**Post-payment:**
- System generate N individual single-use child codes
- Codes dikirim ke WhatsApp customer
- Child codes presented satu-satu saat redemption

### 4.6 Rules

- **No cash-out / no refund** — voucher tidak bisa ditukar uang
- **Quota:** Setiap voucher punya max uses. Used up → `FULLY_REDEEMED`
- **Expiry:** Past expiry → `EXPIRED`. No extension, no refund.
- **Scope:** Most vouchers work cross-outlet dalam tenant. Some outlet/brand-specific — show orange jika wrong place.

### 4.7 Error States

| Message | Meaning | Action |
|---------|---------|--------|
| "Voucher not found or not active" | Wrong code / deactivated | Re-check code |
| "Voucher fully redeemed" | All uses spent | Explain to customer |
| "Voucher expired" | Past expiry | Cannot use |
| "Voucher belum aktif (berlaku mulai …)" | Future-dated reward | Works from start date |
| "Present one of its individual codes" | Parent code entered | Ask for child code |
| Orange badge, no discount | Wrong scope / min not met | Confirm valid for this outlet + service |

---

## 5. Campaign

### 5.1 Konsep

- Promo otomatis yang di-setup owner dari admin dashboard
- Pattern umum: "Beli membership X → dapat N bonus voucher codes gratis"
- **Kasir tidak trigger manual** — campaign fire otomatis saat qualifying purchase

### 5.2 Flow

1. Kasir jual membership (Sell Pack) yang campaign-attached
2. Payment confirmed → campaign auto-grants bonus voucher codes ke phone customer
3. Bonus codes muncul saat lookup customer by phone
4. Customer juga terima codes via WhatsApp

### 5.3 Constraints

- **Scope:** Membership-scoped (trigger on membership purchase, may limited to specific plans)
- **Windows:** Start-end date campaign
- **Caps:** Once per customer / first N customers. Cap hit atau window closed → no bonus (expected, bukan error)
- **Future-dated membership:** Bonus voucher berlaku dari membership start date (sebelumnya "belum aktif")
- **Bonus vouchers:** Single-use codes

### 5.4 Kasir Action

Inform customer post-sale:
> "Pak/Bu, dari promo ini Bapak/Ibu dapat bonus [N] kode voucher cuci — sudah kami kirim ke WhatsApp, dan bisa langsung dipakai di kunjungan berikutnya."

Jika customer tidak lihat → lookup by phone untuk confirm codes granted.

---

## 6. Orders Management

### 6.1 Order Lifecycle

```
Ordered (unpaid)
    ├── → Paid → Confirmed → Completed
    └── → Cancelled (via Void)
```

- **Ordered:** Order dibuat, belum bayar
- **Paid:** Payment confirmed
- **Confirmed:** Internal state (payment verified)
- **Completed:** Service done
- **Cancelled:** Voided

### 6.2 Orders Tab

- **Access:** Sidebar → Orders
- **View:** All today's transactions
- **Search:** Order number, customer name, phone
- **Filter:** All / Ordered / Paid / Confirmed / Completed / Cancelled
- **Scope:** Cashier = own outlet only. Owner/admin = all outlets (filter by outlet available).

**Order card content:**
- Order number, customer name, brand chip(s), operator name
- Status badge (color-coded)
- Item list
- Promo chips: Member / Voucher / Sold: Membership / Campaign
- Total

### 6.3 Actions by Status

| Status | Available Actions |
|--------|-------------------|
| Ordered (unpaid) | Cash/QRIS payment, Void, Receipt |
| Paid / Completed | Void (within rules), Receipt reprint |
| Cancelled | Receipt only |

### 6.4 Settle Unpaid Order

- Find di Orders tab → tap Cash or QRIS
- **Limitation:** Orders tab hanya support Cash/QRIS untuk settle unpaid order
- **EDC/Transfer:** Tidak tersedia di Orders tab. Untuk payment method ini, gunakan Place Order di New Order screen (lihat Section 2.5). Feature EDC/Transfer settling dari Orders tab = future roadmap.

### 6.5 Void / Cancel Rules

**Free void window** (configurable, default 0 minutes):
- Within window: void with reason only, no approval needed
- After window: need **admin PIN** (6-digit via email to owner/admin)
- Owner can always void without PIN

**Void flow:**
1. Orders → find order → tap Void
2. See: order info, free window status, reason box, PIN field (if needed)
3. Fill reason (required): e.g. "wrong service", "customer cancelled"
4. Enter PIN (if required)
5. Confirm

**Warning (if paid):**
> "Payment already collected — this voids the record only; refund must be issued separately."

**On confirm:**
- Order → CANCELLED
- Member usage dari order ini → reversed
- Voucher redemption → reversed
- Activated membership dari order ini → cancelled

**Important:** Void ≠ discount tool. Void hanya untuk genuine errors/cancellations. Pricing disputes → supervisor.

**Refund:** Void tidak otomatis refund. Kasir harus return cash / reverse card manual.

---

## 7. Reports & Summary

### 7.1 Summary Tab

- **Access:** Sidebar → Summary
- **Date range:** Picker (from → to) + Today button

**Stat cards:**
| Stat | Deskripsi |
|------|-----------|
| Total Orders | Semua orders dalam range |
| Revenue | Total pendapatan |
| Paid Count | Order yang sudah dibayar |
| Cancelled Count | Order yang di-void |
| Unique Members | Member yang visit |
| New Members | First-time sign-up |

**By Payment Method:**
- Revenue & count per: Cash / QRIS / EDC / Transfer
- Gunakan untuk reconcile drawer end of shift

**By Service:**
- Top 10 services by quantity dan revenue

**Export:**
- CSV download — orders untuk selected range (untuk owner/accounting)

### 7.2 Multi-Outlet Reporting (Owner/Admin)

- Consolidated view: semua outlets dalam tenant
- Filter by outlet
- Compare outlet performance
- Aggregated stats per outlet

### 7.3 End-of-Shift Reconciliation

1. Set range = Today
2. Check Revenue & By Payment Method vs cash drawer + EDC settlement
3. Note discrepancy → supervisor

---

## 8. Customer Tagging (Automatic)

POS auto-tag setiap order dengan customer type untuk reporting. Kasir **tidak** pilih manual.

| Tag | Trigger | Priority |
|-----|---------|----------|
| `REGULAR` | No membership, no voucher, no pack purchase | Default (fallback) |
| `MEMBER` | Active membership benefit applied (GRATIS or discount) | Higher than REGULAR |
| `VOUCHER` | Voucher applied and counted in order | Higher than MEMBER |
| `NEW_MEMBER` | Membership sold (first time, new plan) | Highest |
| `RENEWAL` | Membership for existing same plan renewed | Highest |
| `BUY_VOUCHER_PACK` | Service-pack voucher sold | Highest |

**Tagging logic:**
- System evaluate order at payment confirmation
- Priority: `BUY_VOUCHER_PACK` / `NEW_MEMBER` / `RENEWAL` > `VOUCHER` > `MEMBER` > `REGULAR`
- Multiple tags possible per order (e.g. `NEW_MEMBER` + `MEMBER` jika customer beli membership DAN pakai benefit di same order)
- Tag stored di `order.customer_type` field
- Void/cancel → tag reverted (jika membership cancelled, tag tidak count di reports)

**Rule:** Run transaction correctly (lookup member, apply voucher, use Sell Pack) → tagging otomatis.

---

## 9. Aturan Lintas Modul (Cross-Cutting Rules)

### 9.1 Golden Rules

1. **Tap Check sebelum charge** — member dapat harga special, regular cek data existing
2. **Member max 1x/hari** per plate (configurable per plan)
3. **Voucher + Membership = membership TIDAK terpakai** (voucher wins)
4. **1 voucher = 1 transaksi**, child code bukan parent
5. **Multiple vouchers OK** di different transactions dalam 1 hari
6. **Main service required** — tidak bisa add-on only
7. **Void ≠ refund** — return cash / reverse card manual
8. **Reconcile per payment method** end of shift

### 9.2 Validation Matrix

| Check | Rule | Error |
|-------|------|-------|
| Name | Required | "Name is required" |
| Phone | Required, min 8 digits | "Phone must be at least 8 digits" |
| Cart | Not empty | "Add at least one service" |
| Main service | ≥1 in cart | "Add a main wash service first" |
| Voucher min | Min order met | "Minimum order amount not met" |
| Member plate | Select matching plate | "Select vehicle plate" |

### 9.3 Error State Master

| Symptom | Root Cause | Resolution |
|---------|-----------|------------|
| Member found, full price | Forgot Check / wrong outlet / daily limit | Tap Check, verify plan |
| "Membership expired" | Past date / quota reached | Offer renewal Sell Pack |
| "Voucher fully redeemed" | All uses spent | Explain to customer |
| "Voucher expired" | Past expiry | Cannot use |
| "Voucher belum aktif" | Future-dated | Wait until start date |
| "Present individual codes" | Parent code entered | Ask for child code |
| Orange voucher badge | Wrong scope | Confirm outlet/brand match |
| Can't place order | Add-on only, no main service | Add main wash first |

---

## 10. Rekomendasi Tech Stack

### 10.1 Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend (PWA)                  │
│         Next.js + React + Tailwind CSS            │
│    Web Bluetooth API (receipt printer)            │
├─────────────────────────────────────────────────┤
│                   Backend API                     │
│       Next.js API Routes / Node.js                │
│       Row-Level Security (multi-tenant)           │
├─────────────────────────────────────────────────┤
│                   Data Layer                      │
│    PostgreSQL (Supabase) + RLS Policies           │
├─────────────────────────────────────────────────┤
│                  Integrations                     │
│  Xendit (QRIS) │ WhatsApp API │ Supabase Auth    │
└─────────────────────────────────────────────────┘
```

### 10.2 Stack Detail

| Layer | Technology | Alasan |
|-------|-----------|--------|
| Frontend | Next.js + React PWA | Handbook mention PWA installable, URL `/pos/<id>` |
| Styling | Tailwind CSS | Rapid UI, responsive tablet-first |
| Backend | Next.js API Routes atau Node.js (Fastify) | JS fullstack, team efficiency |
| Database | PostgreSQL (Supabase) | Relational data (quota, voucher, orders). RLS native. |
| Auth | Supabase Auth | Email+password, role-based (Owner/Admin/Cashier), multi-tenant RLS |
| Payment | Xendit | Handbook explicitly mention Xendit for QRIS dynamic |
| WhatsApp | WhatsApp Business API | Welcome messages, voucher delivery, expiry reminders, campaign codes |
| Printer | Web Bluetooth API | Handbook mention Bluetooth receipt printer |
| Hosting | Vercel | Next.js native, edge functions, global CDN |
| State | Zustand atau React Context | Cart state, order flow management |

### 10.3 Data Model (High-Level)

```
tenant
  id, name, plan, status, created_at

outlet
  id, tenant_id, name, agent_id, address, is_active

user
  id, tenant_id, email, role (owner|outlet_admin|cashier), outlet_id (nullable), name

customer
  id, tenant_id, name, phone, plates[]
  -- tenant-level, accessible cross-outlet

order
  id, number, tenant_id, outlet_id, operator_id, customer_id
  status (ordered|paid|confirmed|completed|cancelled)
  customer_type (regular|member|voucher|new_member|renewal|buy_voucher_pack)
  subtotal, service_charge, tax, voucher_discount, promo_discount, total
  payment_method, payment_ref, note, created_at

order_item
  id, order_id, service_id, qty, unit_price, discount, subtotal
  member_pricing (boolean), membership_id (nullable)

service
  id, tenant_id, outlet_id (nullable=null=all outlets), name, category, price, is_active

membership_plan
  id, tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price
  outlet_ids[] (nullable=all), free_services[], discounted_services[]

membership
  id, customer_id, plan_id, start_date, end_date, status (active|expired|pending|cancelled)
  uses_count, tenant_id

membership_plate
  id, membership_id, plate, brand, model

membership_usage
  id, membership_id, plate, order_id, used_at

voucher_template
  id, tenant_id, name, type (fixed|percentage|service_pack), value
  max_uses, expiry_date, outlet_ids[] (nullable=all)
  brand_scope, service_scope, min_order_amount

voucher_pack
  id, template_id, customer_id, parent_code, total_uses, uses_count
  status (active|fully_redeemed|expired), tenant_id

voucher_code
  id, pack_id, child_code, status (active|redeemed|expired)
  redeemed_at, order_id

campaign
  id, tenant_id, name, plan_id, bonus_template_id
  start_date, end_date, cap, per_customer_limit, status

campaign_grant
  id, campaign_id, customer_id, voucher_pack_id, granted_at
```

**Foreign Key & Cascade Rules:**

| Relationship | FK | Cascade |
|-------------|-----|---------|
| outlet → tenant | `tenant_id` | RESTRICT (cannot delete tenant with active outlets) |
| user → tenant | `tenant_id` | CASCADE |
| user → outlet | `outlet_id` | SET NULL (outlet deleted → user stays, unassigned) |
| customer → tenant | `tenant_id` | CASCADE |
| order → tenant | `tenant_id` | RESTRICT |
| order → outlet | `outlet_id` | RESTRICT |
| order → user (operator) | `operator_id` | RESTRICT |
| order → customer | `customer_id` | RESTRICT |
| order_item → order | `order_id` | CASCADE |
| order_item → service | `service_id` | RESTRICT |
| membership → customer | `customer_id` | RESTRICT |
| membership → plan | `plan_id` | RESTRICT |
| membership_plate → membership | `membership_id` | CASCADE |
| membership_usage → membership | `membership_id` | CASCADE |
| membership_usage → order | `order_id` | SET NULL (void order → usage record kept, marked reversed) |
| voucher_pack → template | `template_id` | RESTRICT |
| voucher_code → pack | `pack_id` | CASCADE |
| voucher_code → order | `order_id` | SET NULL (void order → code freed, not deleted) |
| campaign → plan | `plan_id` | RESTRICT |
| campaign_grant → campaign | `campaign_id` | CASCADE |
| campaign_grant → voucher_pack | `voucher_pack_id` | RESTRICT |

### 10.4 Multi-Tenant Security

- **Row-Level Security (RLS):** Every query scoped to `tenant_id`
- **Cashier:** `WHERE outlet_id = cashier.outlet_id`
- **Owner:** `WHERE tenant_id = owner.tenant_id`
- **Platform Admin:** No RLS restriction

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| Service Profile | Mode POS car wash (plate/brand/model fields, bukan table picker) |
| Outlet | Cabang fisik. Pilot = AIRE Kencana Loka |
| Tenant | Satu bisnis / brand yang punya multiple outlet |
| Brand / Business Unit | AIRE (wash) vs LEAD (detailing) — tagged per order |
| Membership | Paket loyalty prepaid: free/discount washes, max 3 plates |
| Usage / Quota | Sisa cuci member (lifetime + per-day/period) |
| Voucher | Kode redeemable: discount atau prepaid wash |
| Voucher Pack (parent/child) | Multi-use pack; redeem child codes satu-satu |
| Campaign | Promo otomatis — beli membership → bonus voucher codes |
| Sell Pack | Button untuk jual membership atau voucher pack |
| Void | Cancel order (free window + admin PIN setelahnya) |
| Operator | Kasir yang tercatat di order |
| WIB | Jakarta time — daily quota reset 00:00 WIB |
| RLS | Row-Level Security — database-level multi-tenant isolation |

---

## 12. Lampiran

### A. Sumber
- AIRE Cashier Handbook Kencana Loka, v1.0 (pilot edition)
- AIRIN Brand System

### B. Out of Scope (untuk PRD ini)
- AI WhatsApp agent (VINA)
- Outlet-specific hardware integration (selain Bluetooth printer)
- Laundry profile (POS hanya Service profile untuk car wash)
- Subscription/billing management (SaaS pricing tiers)
- Mobile native app (PWA only)

### C. Future Considerations
- EDC/Transfer settling dari Orders tab
- Multi-brand support (AIRE wash + LEAD detailing dalam 1 tenant)
- Loyalty points system
- Customer self-service portal
- Inventory management (product sales tracking)
