# AIRE Operations Platform — Consolidated Requirements

**Status:** Consolidated source of truth (supersedes the scattered notes)
**Consolidated:** 2026-06-30
**Sources merged:** PRD v1.2 (`Aire Car Wash - v1 2.md`) + three rapid client note batches (Notion summary + two near-duplicate AI/session dumps).

> Purpose of this doc: the recent client notes came in fast, from different sessions, with heavy duplication (the dashboard-tab list appeared 3×, the brand/membership/voucher bullets repeated almost verbatim). This document de-duplicates them into one organized spec, reconciles them with the PRD v1.2, and flags the current build status + open questions. Each requirement appears exactly once.

---

## 1. Business Context

AIRE runs a car-wash & detailing business with **10 branches** across Jabodetabek and Surabaya. Two co-located brands operate under one company:
- **AIRE** — car wash (exterior, standard, complete, premium tiers).
- **LEAD** — detailing & polishing (coating: Stella/Prime/Pro, paint treatment, engine/aircon/seat cleaning, grooming).

The platform replaces manual Google-Sheets operations with a POS (PWA), a management dashboard, and a WhatsApp AI agent.

---

## 2. Glossary (canonical terms — removes naming overlap)

| Term | Meaning |
|------|---------|
| **Tenant** | The company/account. Platform is multi-tenant; AIRE is one tenant. |
| **Branch** (= Outlet/Cabang) | A physical location. AIRE has 10. Has name, address, legal entity (PT). |
| **Brand** (= Business Unit) | AIRE or LEAD. Configured **per branch**. Each transaction belongs to exactly one brand. |
| **Product** (= Service/Item) | Anything sold: wash service, detailing service, retail item, or membership package. Belongs to a Category + Brand, scoped to all or specific branches. |
| **Category** | Grouping of products (e.g. Car Wash, Coating, Retail). |
| **Membership** | A subscription tied to a customer; covers up to 3 plates; 1 wash/day per plate. |
| **Voucher** | A shareable digital code (not plate-bound) sold in bundles, delivered via WhatsApp. |
| **Promotion** | A rule that grants a discount or a free product/service/voucher on qualifying purchases, with a quota. |

---

## 3. Functional Requirements

### 3.1 Multi-Tenant & Branches (true SaaS)
- FR-1.1 All data and features must be **multi-tenant** isolated. The product is a **true SaaS**: any tenant can self-provision and operate independently.
- FR-1.2 **A tenant can own multiple branches**, each **individually labeled and configured**, and **created by the tenant themselves** (not only by the platform super admin). AIRE is one such tenant with 10 branches.
- FR-1.3 **Branch CRUD** — name, address, legal entity (**PT**). The **PT is a label only** (minimal DB footprint, freely changeable; editing it requires a higher-level permission). Support ≥10 branches per tenant.
- FR-1.4 **Payment methods are CRUD per branch** (see 3.9).
- FR-1.5 **Brands (AIRE/LEAD) are configurable per branch.**

### 3.2 Users, Roles & RBAC (dynamic)
- FR-2.1 **User CRUD** with **multi-branch placement** (a user can be assigned to several branches via multi-select).
- FR-2.2 One **supervisor/staff can oversee multiple branches**; one **cashier can work rolling across multiple branches**.
- FR-2.3 **Role CRUD with fully dynamic RBAC** — roles and their access permissions are **defined and controllable through the UI** (not hard-coded). Managing roles/permissions requires a **higher-level permission**.
- FR-2.4 Each transaction records the logged-in operator and (separately) the salesperson name.

### 3.3 Products, Categories & Brand
- FR-3.1 **Product CRUD** with **branch scope**: "all branches" or a **multi-select of specific branches**. Products can differ per branch.
- FR-3.2 **Category CRUD.**
- FR-3.3 **Brand CRUD.** When creating a product, **Category and Brand are required first**.
- FR-3.4 Per-branch, per-product pricing (regular + member rates).

### 3.4 Membership
- FR-4.1 One membership covers **multiple cars, max 3 plates** (plate number, vehicle brand, vehicle type recorded per plate).
- FR-4.2 Each membership allows **1 wash per day per plate** (so up to 3 washes/day across 3 cars, but never twice/day for the same car).
- FR-4.3 Track the **branch where the membership was purchased (home branch)** vs the **branch where each wash is redeemed**. The selling branch **owes the redeeming branch**; the system must support **both rich tracking AND a payout/settlement flow** — a rich settlement report at the top level, with flexible per-branch / per-transaction drill-down downstream.
- FR-4.4 Membership tiers (1-month / 3-month / 12-month) with purchase date, effective start, expiry.
- FR-4.5 Plate add/update from POS (dynamic + button, up to 3) and from dashboard, with an activity/change log.
- FR-4.6 **Membership status definitions:**
  - **Active** — current date is within the membership duration (≤ end date).
  - **Suspended** — H+1 to H+14 after the end date (14-day grace window).
  - **Expired** — H+15 onward.

### 3.5 Voucher (digital, shareable)
- FR-5.1 Vouchers are sold in **bundles** (e.g. buy 15). Replaces the old physical cards.
- FR-5.2 On purchase, the system **generates unique codes and sends them to the buyer's WhatsApp**.
- FR-5.3 A voucher code is **usable by anyone** — the buyer can share with friends (no plate/customer binding at redemption).
- FR-5.4 **Code format:** `{BRANCH}-{ISSUEDATE}-{NUMBER}` =
  - **3 letters** — branch code (from the branch name), then
  - **6 digits** — issuance date, then
  - **6 digits** — sequential voucher number.

  Example: `BTR-062026-000123` (branch BTR, issued 06/2026, voucher #000123). The sequential 6-digit number guarantees uniqueness within a branch+date.
- FR-5.5 Validation at redemption: code exists, not expired, not already redeemed (single-use).

### 3.6 Promotions
- FR-6.1 **Promotion CRUD**: name, start/end date, active/inactive, description, **applicable branch(es)**.
- FR-6.2 Trigger: purchase of a specific product **or all products**.
- FR-6.3 Reward types: **fixed-nominal discount**, **percentage discount**, **bundled free physical product** (microfiber, perfume), **free wash voucher**, or **a special discount on a future purchase** (e.g. next LEAD coating).
- FR-6.4 **Max quota** per promotion (limit how many grants can be issued).

### 3.7 POS (PWA — mandatory)
- FR-7.1 Delivered as a **PWA**, installable; responsive for **tablet/PC**, must fit a **Samsung 7" tablet**.
- FR-7.2 **Order flow:**
  1. Enter/search customer + plate (create new customer if needed): name, phone, plate, vehicle brand, vehicle type.
  2. Select product(s) **or a package/membership**. If a membership is sold, the cashier adds up to 3 plates (plate + brand + type) inline via a **+ button**.
  3. Payment: choose a method (see 3.9) — methods are **dynamic per branch with logos**. **Cash** must compute amount tendered and change.
- FR-7.3 Cashier can view **payment history** and the **daily transaction total** (for reporting).
- FR-7.4 **Queue input (restaurant-table style):** when a car arrives the cashier first records plate + brand + type (e.g. `D1234ABC, Honda, Brio`), **sequentially in arrival order**; product + payment are completed **after treatment finishes**.

### 3.8 Brand selection at POS
- FR-8.1 A transaction belongs to one brand (AIRE/LEAD); the catalog, pricing, and payment channels shown follow the selected brand.

### 3.9 Payment Methods
- FR-9.1 **Payment method CRUD per branch** from the dashboard (EDC A/B/C, QRIS, cash, transfer, CC, etc.).
- FR-9.2 Each method has a **logo + color** shown in POS to prevent mis-clicks (e.g. EDC BRI = orange + EDC logo; QRIS BCA = blue + QR logo).
- FR-9.3 Revenue is attributed to the correct brand account/channel.

---

## 4. Dashboard (tabs)

> The client listed the dashboard tabs three times with minor variations. Consolidated into one canonical tab set below.

### 4.1 Tab: Branch (Cabang)
- Branch CRUD (name, address, PT).
- Payment-method CRUD per branch.
- Brand CRUD per branch.

### 4.2 Tab: Transaction
- Revenue chart (Daily / Weekly / Monthly / Custom range).
- Sales-per-product chart (Daily / Weekly / Monthly / Custom range).
- Transactions data table: show **top 20**, with options "today (all)" or "everything", pagination **20/50/100**; row actions **View detail / Edit / Delete**. Edit/Delete is **gated by role + written to the audit log + respects day-lock**.
- Embedded **AI Analysis** sub-tab (AI auto-analyzes the current data).
- **Export transaction report → Excel** (all, or filtered per payment channel e.g. EDC A, QRIS).
- **Export Executive Report → PDF** (visually polished; AI renders nice HTML which is converted to PDF via html-to-pdf).

### 4.3 Tab: Customer & Member (CRM)
- Customer charts: total customers, new customers (Daily / Weekly / Monthly / Custom).
- Customer data table (Name, Phone, first-seen date) → View / Edit / Delete.
- **Membership sub-tab** filtered by **Active** (within duration), **Suspended** (H+1…H+14 after end date), **Expired** (H+15 onward).
  - View linked customer, CRUD plate numbers, usage count, and the **plate-change / member-activity log**.

### 4.4 Tab: Conversation Log
- View customer ↔ AI Agent conversations in **realtime**.
- **New session** button (restart the AI agent session).
- **Stop/Start** the AI agent's auto-replies for a conversation.
- **AI-generated conversation summary**.

### 4.5 Tab: Product / Brand
- Product CRUD with branch scope (all or multi-select branches).
- Category CRUD.
- Brand CRUD (Category + Brand required when creating a product).

### 4.6 Tab: Promotion
- Promotion CRUD per section 3.6.

### 4.7 Tab: User
- User CRUD + multi-select branch placement.
- Role CRUD + RBAC access.

### 4.8 Tab: Agentic AI
- Set the agent **base prompt**.
- **WhatsApp number connection:** connect via **QR scan** using an **unofficial WA gateway** (implementer's choice — e.g. WAHA / GoWA). Also provide a **Kapso.com** option where the user enters API key, number, etc.
- Set **max messages per user per day**.
- Set **Product Knowledge** (opening hours, products, membership, SOP).
- Set **AI Agent Skills**.
- Set **escalation number** — the AI escalates to an admin/supervisor number for questions it can't answer.

---

## 5. WhatsApp AI Agent (behavior)
- Outbound: membership lifecycle reminders (purchase confirmation; H-30 for 3m/12m; H-7 all tiers; H-day all tiers) and voucher-code delivery.
- Inbound: customer CS bot grounded in per-branch Product Knowledge; answers hours/products/pricing/membership status; caches FAQ to limit token cost; escalates to a human (escalation number) on low confidence / explicit request / out-of-scope.
- No transaction capability via WhatsApp in Phase 1.

---

## 6. Non-Functional
- **PWA**: installable, offline-tolerant shell, responsive down to a 7" tablet.
- **Multi-tenant isolation** enforced at the data layer (per-tenant scoping/RLS).
- **Realtime** updates for the conversation log and (ideally) queue board.
- **Exports**: Excel (transactions) and PDF (executive report via AI-rendered HTML).
- Server-side pricing resolution; immutable historical transactions.

---

## 7. Current Build Status (reconciliation)

Legend: ✅ done · 🟡 partial · ❌ missing

| Area | Status | Notes |
|------|--------|-------|
| Multi-tenant base, branches/outlets | 🟡 | Outlets + tenant isolation exist; **Branch CRUD UI + legal-entity (PT) field** missing. |
| RBAC dynamic + multi-branch user placement | ❌ | Users currently have a single `outlet_id`; need many-to-many user↔branch + dynamic roles. |
| Brands AIRE/LEAD | ✅ | Per-unit catalog, POS selector, payment channel, BU-segregated reporting (shipped). |
| Products: category | 🟡 | Category enum exists; **Category/Brand CRUD + product-as-first-class with brand scoping** missing. |
| Product branch scoping (all/specific multi) | ❌ | Today a product is all-outlets or a single outlet; need multi-branch array. |
| Membership multi-plate (max 3), 1/day/plate | ✅ | Implemented. |
| Membership home-branch + inter-branch settlement | ❌ | No home-branch tag / settlement ledger. |
| Voucher digital + WA delivery | 🟡 | Pack sell + WA delivery exist, but **code format is hashed `AIRE-VC-...`, not `BTR-06A784`**, and redemption is currently single-use, tenant-scoped — needs the shareable, outlet-coded format. |
| Promotions (discount/bundle/quota) | ❌ | Campaign add-on grants exist for memberships only; full promotion engine missing. |
| POS PWA + flow | 🟡 | POS works (services, payment, shifts); **customer search/create, vehicle brand+type capture, inline membership plate add, payment-method logos, queue input** missing or partial. |
| Payment methods CRUD per branch + logos | ❌ | Methods are a fixed enum; no per-branch CRUD or logos. |
| Queue input (resto-style, arrival order) | 🟡 | `queue_entries` + queue board exist; the POS arrival-first capture flow missing. |
| Dashboard: Transaction tab (charts, AI analysis, Excel, exec PDF) | 🟡 | Reports + CSV + AI assistant exist; **charts, edit/delete rows, Excel, AI-HTML→PDF** missing. |
| Dashboard: CRM tab (customers, membership filters, plate log) | 🟡 | Member lookup exists; **customer CRM table + Active/Suspended/Expired filters + activity log UI** missing. |
| Conversation Log tab (realtime, start/stop, summary) | ❌ | Chatbot webhook exists; no realtime log UI / session controls / summary. |
| Promotion tab | ❌ | Missing. |
| User tab (CRUD + placement + role RBAC) | ❌ | Missing UI; depends on RBAC rework. |
| Agentic AI tab (prompt, WA QR/Kapso, caps, knowledge, skills, escalation) | 🟡 | AI settings + base prompt + message caps partially exist; **WA-QR/Kapso connection, product-knowledge editor, skills, escalation number** missing. |

---

## 8. Resolved Decisions (client-confirmed)
1. **Voucher code** = `BRANCH(3 letters) + ISSUEDATE(6 digits) + NUMBER(6 digits)`, e.g. `BTR-062026-000123`. Single-use; sequential number guarantees uniqueness.
2. **Inter-branch settlement** must support **both tracking and an actual payout flow** — rich settlement report at the top level, flexible drill-down downstream.
3. **Membership states:** Active = within duration · Suspended = H+1…H+14 after end date · Expired = H+15 onward.
4. **WA gateway:** default to **WAHA** (Dockerized, QR-scan) for the unofficial path; Kapso as the alternative.
5. **PT / legal entity:** a **label** on the branch (minimal DB impact, freely changeable; edits require higher-level permission).
6. **Edit/Delete transaction:** allowed, but **role-gated + audit-logged + day-lock-respecting**.
7. **True SaaS:** tenants self-provision; a tenant owns and **creates its own branches**, each individually labeled and configured.
8. **RBAC:** fully **dynamic and UI-controllable**; managing roles/permissions requires a higher-level permission.

---

## 9. Recommended Delivery Phases
1. **Foundation:** Branch CRUD (+PT), dynamic RBAC + multi-branch user placement, Payment-method CRUD per branch (+logos), Product/Category/Brand CRUD with multi-branch scoping.
2. **Commerce:** Membership home-branch + settlement ledger; Voucher redesign (`BTR-06A784`, shareable, WA delivery); Promotion engine.
3. **POS UX:** customer search/create, vehicle capture, inline membership plates, payment logos, resto-style queue input.
4. **Dashboard:** Transaction (charts/Excel/exec-PDF/AI analysis), CRM, Promotion, User tabs.
5. **AI:** Conversation Log (realtime + start/stop + summary), Agentic AI settings (WA QR/Kapso, knowledge, skills, escalation).
