# AIRE — Progress Tracker

**Updated:** 2026-06-30
Legend: `[x]` done & deployed · `[~]` partial · `[ ]` not started

---

## ✅ DONE (built, tested, deployed to VPS)

### Platform & Infra
- [x] Multi-tenant data model + tenant isolation (RLS)
- [x] Dockerized stack on VPS (postgres, redis, minio, mosquitto, backend, frontend, nginx)
- [x] Shared-VPS port hardening (only frontend public on :3000; infra on loopback)
- [x] Next.js `/api` + `/socket.io` rewrites (frontend self-sufficient)
- [x] PWA shell (service worker + manifest)
- [x] Migrations runner (`schema_migrations`), currently applied through `011`

### Auth & Access
- [x] Login / JWT sessions / refresh
- [x] Register (creates tenant + owner)
- [x] Forgot / reset password (Redis token)
- [x] Role hierarchy guard (super_admin > owner > outlet_admin > cashier)
- [x] Demo accounts (super admin, owner, cashier) + clickable demo login cards
- [x] Role-based post-login routing (cashier → POS, others → Hub)

### Navigation
- [x] Full-screen Hub landing page (Dashboard / POS / Kiosk / Queue Board / Admin)
- [x] Admin tile only shown to super admin
- [x] Hub "home" links wired across dashboard, POS, admin

### Branding / UI
- [x] ConextLab brand system applied (blue/black/white tokens, Geist + JetBrains Mono)

### POS (baseline)
- [x] New order: service grid, cart, customer name/phone/plate
- [x] Payment: cash (+change), QRIS dynamic (gateway), EDC, transfer
- [x] Voucher redemption at POS
- [x] Orders list, order summary, POS shift page
- [x] POS shift open/close, petty cash, shift issues, cash reconciliation

### Business Unit (AIRE / LEAD) — TASK shipped
- [x] `business_unit` on services + orders (migration 011)
- [x] Per-unit service catalog + POS unit switch (clears cart on switch)
- [x] Payment channel (AIRE/LEAD) + CC method + salesperson name
- [x] BU-segregated reporting (`byBusinessUnit`) + BU filter + CSV columns

### Membership & Voucher (existing)
- [x] Membership plans, multi-plate (max 3), 1 wash/day/plate
- [x] Plate → member lookup
- [x] Voucher templates / packs / codes (sell + issue), WA delivery
- [x] Campaign add-on grants at membership sale

### Other modules (built earlier)
- [x] Services CRUD (now with business unit)
- [x] Memberships management page
- [x] Inventory, Finance, Sales, HR, Procurement modules + pages
- [x] HR/Payroll (schedules, attendance, leave, holiday, bonus/deduction/advance, loans, payroll gen + CSV)
- [x] Daily/shift sales reports + CSV export
- [x] AI agent platform: event bus, monitoring panel, chat, real tools
- [x] AI master on/off toggle + per-feature toggles
- [x] WhatsApp expiry reminders (H-30/H-7/H-day) + welcome
- [x] Inbound WhatsApp chatbot webhook (basic)
- [x] Payment gateway env-var wiring + sandbox provider (production-grade mock)
- [x] Admin: Tenants CRUD, Platform Config, Billing view, Support view
- [x] Kiosk + Queue Board public pages
- [x] ALPR detections service (Phase 2 groundwork)
- [x] Audit log table

---

## 🟡 PARTIAL (exists but needs work to meet new requirements)

- [~] **Branches/Outlets** — data model exists; **no Branch CRUD UI, no legal-entity (PT) field**
- [~] **Products** — services have category enum; **no Category/Brand CRUD, no first-class Product with brand scoping**
- [~] **Voucher** — pack sell + WA delivery work; **code format is hashed `AIRE-VC-...`, not shareable `BTR-06A784`**
- [~] **POS flow** — works, but missing: customer **search/create**, vehicle **brand + type** capture, inline **membership plate add (+ up to 3)**, payment-method **logos**
- [~] **Queue** — `queue_entries` + board exist; **resto-style arrival-first capture in POS** missing
- [~] **Transaction dashboard** — reports + CSV + AI assistant exist; **charts, row edit/delete, Excel export, AI-HTML→PDF executive report** missing
- [~] **CRM** — member lookup exists; **customer table + Active/Suspended/Expired filters + plate activity log UI** missing
- [~] **Agentic AI settings** — base prompt + message caps partially exist; **WA QR/Kapso connect, product-knowledge editor, skills, escalation number** missing
- [~] **Multi-tenant** — isolation done; needs to scale cleanly to the 10-branch model

---

## ❌ NOT STARTED (new requirements)

### Foundation (Phase 1 — ✅ DONE & deployed)
- [x] Branch CRUD UI (name, address, PT label — higher-permission to edit), tenant-created
- [x] Payment-method CRUD **per branch** (+ logo + color in POS dashboard)
- [x] Brand CRUD per branch
- [x] Dynamic RBAC — role CRUD + assignable permissions, UI-controllable (higher permission)
- [x] User CRUD + **multi-branch placement** (one staff → many branches; rolling cashier)
- [x] User↔branch many-to-many model (`user_outlets`)
- [x] Product multi-branch scope backend (`outlet_ids`) + category/brand columns
- [x] Category CRUD
- [x] Brand required + Category required on product create (backend ready)
- [ ] Product create/edit UI wiring for category + brand + multi-branch select (POS payment-method logos) — small follow-up

### Commerce
- [ ] Membership **home-branch** tag
- [ ] **Inter-branch settlement**: tracking ledger **+ payout flow** (top-level settlement report + drill-down)
- [ ] Voucher redesign: `BRANCH(3)+ISSUEDATE(6)+NUMBER(6)` (e.g. `BTR-062026-000123`), shareable (no plate bind), buy-N bundles, single-use
- [ ] **Promotion engine**: discount (fixed/percent) OR bundle (free product/service/voucher/future-discount), per-branch, with max quota

### POS UX
- [ ] Customer search + create-new in POS
- [ ] Vehicle brand + type capture (master list)
- [ ] Inline membership plate add (+ button, up to 3) at sale
- [ ] Payment-method buttons with logos/colors
- [ ] Daily transaction total + payment history view for cashier
- [ ] Queue input (resto-style, arrival order; product/payment at end)
- [ ] Tablet 7" responsive pass

### Dashboard tabs
- [ ] Transaction: revenue chart (D/W/M/custom)
- [ ] Transaction: sales-per-product chart
- [ ] Transaction: table top-20 + today/all + pagination 20/50/100 + view/edit/delete
- [ ] Transaction: AI Analysis sub-tab
- [ ] Transaction: Excel export (all / per payment channel)
- [ ] Transaction: Executive Report PDF (AI-rendered HTML → PDF)
- [ ] CRM: customer total / new-customer charts (D/W/M/custom)
- [ ] CRM: customer table (view/edit/delete)
- [ ] CRM: membership filters (Active / Suspended ≤H+14 / Expired >2wk)
- [ ] CRM: plate CRUD + usage count + activity/change log
- [ ] Conversation Log: realtime customer↔AI view
- [ ] Conversation Log: new-session button
- [ ] Conversation Log: stop/start AI auto-reply
- [ ] Conversation Log: AI summary
- [ ] Promotion tab (CRUD per promotion engine)
- [ ] User tab (CRUD + placement + role RBAC)

### Agentic AI
- [ ] Base prompt editor (full)
- [ ] WA number connect via QR (unofficial gateway: WAHA/GoWA)
- [ ] Kapso.com option (API key, number)
- [ ] Max messages per user per day
- [ ] Product Knowledge editor (hours, products, membership, SOP)
- [ ] AI Agent Skills config
- [ ] Escalation number config

### From PRD v1.2 still open
- [ ] Effective-date pricing (PriceRule) + size variants (S/M, L/XL)
- [ ] Transaction status `testing` / `claim` (excluded from revenue)
- [ ] Discount controls (max per category, admin-only field, approval over threshold)
- [ ] Day-lock immutability + admin re-open with audit
- [ ] Retail Product entity + bundle pricing
- [ ] Vehicle make/model master list
- [ ] Membership upgrade mid-flow (deduct paid wash)
- [ ] Same-day double-use on-screen flag at POS
- [ ] Admin WA notification on plate add/update
- [ ] Google Sheets one-time import
- [ ] LPR auto-prefill into POS session (Phase 2)

---

## Decisions locked (no longer blocking)
1. Voucher code = `BRANCH(3) + ISSUEDATE(6) + NUMBER(6)`, e.g. `BTR-062026-000123`, single-use
2. Inter-branch settlement = tracking **+ payout flow** (rich top-level report, flexible downstream)
3. Membership: Active=within duration · Suspended=H+1…H+14 · Expired=H+15+
4. WA gateway default = WAHA (QR-scan); Kapso alternative
5. PT = label on branch (changeable, higher-permission edit)
6. Transaction edit/delete = role-gated + audit-logged + day-lock
7. True SaaS: tenant self-provisions and **creates its own branches**, each individually configured
8. RBAC = fully dynamic + UI-controllable (higher-permission to manage)
