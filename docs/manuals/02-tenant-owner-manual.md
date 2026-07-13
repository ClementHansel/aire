# Tenant Owner / Manager — User Manual

**Who this is for:** you **own or manage one business** on airin. You control **everything inside
your business** — all your outlets (branches), staff, service menu, prices, memberships, vouchers,
promotions, stock, finance, HR, and the AI assistant.

Your workspace is the **Dashboard** (`/dashboard`). This manual walks you through it, in the order
you'll actually use it — **set-up first, then day-to-day, then reporting**.

> **What you'll see may differ slightly.** Your sidebar only shows the **modules** the platform has
> switched on for your business (the default is *everything on*). If something described here isn't
> in your sidebar, that module is off — ask your platform administrator to enable it.

> **You won't use `/admin`.** That "Platform Admin" area belongs to the platform operator, not to
> businesses. You run everything from the **Dashboard**.

---

## Table of contents

1. [Sign in & the Hub](#1-sign-in--the-hub)
2. [Find your way around the Dashboard](#2-find-your-way-around-the-dashboard)
3. [First-time setup (the guided wizard)](#3-first-time-setup-the-guided-wizard)
4. [Setup in detail — do these in order](#4-setup-in-detail--do-these-in-order)
5. [Customers, memberships & bookings](#5-customers-memberships--bookings)
6. [Vouchers & promotions](#6-vouchers--promotions)
7. [Inventory, recipes, COGS & finance](#7-inventory-recipes-cogs--finance)
8. [Reporting](#8-reporting)
9. [People — HR & payroll](#9-people--hr--payroll)
10. [AI assistant & WhatsApp](#10-ai-assistant--whatsapp)
11. [Settings & configuration](#11-settings--configuration)
12. [Tips & troubleshooting](#12-tips--troubleshooting)

---

## 1. Sign in & the Hub

1. Open your business's app URL.
2. Enter your email and password and click **Sign in** (or click the **Tenant Owner** demo card on a
   demo system).
3. You arrive at the **Hub** — a launcher with tiles for **Dashboard**, **Point of Sale**, and
   **Self-Service Kiosk**. Click **Dashboard**.

![The Hub launcher — choose Dashboard, Point of Sale, or Self-Service Kiosk.](images/pos-00-hub.png)

> **Language:** the **EN / ID** toggle (bottom-left of the Dashboard, and on every screen) switches
> English ↔ Indonesian at any time.

---

## 2. Find your way around the Dashboard

The Dashboard has a **left sidebar** grouped into sections. You scroll it to reach everything. The
main groups are:

| Group | What lives there |
|-------|------------------|
| *(top)* | **Hub**, **Overview** |
| **ANALYTICS** | Transactions, Refunds, Invoices, Reports, Sales & Leads, Shifts & Cash |
| **CUSTOMERS** | Customers & CRM, Bookings, Memberships, Vouchers, Feedback & NPS, WA Broadcast |
| **CATALOG / OPERATIONS** | Services, Catalog, Products, Inventory, Procurement, Stock Opname, COGS, Promotions |
| **FINANCE** | Finance, Settlement, Accounting, Commission |
| **PEOPLE** | Users & Roles, HR, Payroll |
| **AI** | AI Assistant, Agent Workflow, Agentic AI / WhatsApp, Conversations, Monitoring |
| **SETTINGS** | Settings, Branches, Payment Methods, Payment Gateway, Designers, Devices |

At the **bottom-left**: your name & role, the **EN/ID** toggle, and **Sign out**. The **Overview**
page is your home base:

![Dashboard Overview — headline tiles (Outlets, Members served, Orders, Revenue), AI proposals, and quick links. Use the branch selector (top-right) to focus on one outlet.](images/owner-overview.png)

- The **branch selector** (top-right on most pages) lets you view **all branches** together or focus
  on **one outlet**.
- **AI Action Proposals** surfaces recommendations from the AI agent (if you've enabled AI).

---

## 3. First-time setup (the guided wizard)

The fastest way to get a brand-new business ready is the **onboarding wizard**. New owners are
guided into it automatically; you can also open it from **`/dashboard/onboarding`**.

It walks you through six steps, shown as a progress bar at the top:

**Company → Branch → Services → Staff → Finance → Done**

![The onboarding wizard — step 2 (Branch). The stepper across the top shows all six steps.](images/onb-01.png)

For each step, fill the fields and click **Save & continue** (use **Back** to revisit). For example,
the **Branch** step asks for the branch name, a **3-letter branch code**, an optional legal entity,
address, a **WhatsApp phone number**, and your default **service charge %** and **tax (PPN) %**.

> You can skip the wizard and configure everything from the individual pages below instead — the
> wizard just does them in a sensible order. Nothing you set in the wizard is locked; you can change
> it later.

---

## 4. Setup in detail — do these in order

Even if you used the wizard, here's every setup area and what it does. **Do them top to bottom** the
first time.

### 4.1 Branding (Settings → Branding)
Set your company name, logo, colours, fonts and dark-mode policy. This themes your **whole app** and
your **public pages** (eMenu, kiosk, member portal). Your read-only **tenant code** is shown here.
(Full Settings walkthrough in §11.)

### 4.2 Branches — your outlets
**Sidebar → Branches** (`/dashboard/branches`). Add each physical outlet.

1. Click **+ Add Branch**.
2. Enter the **name**, a **3-letter code**, the **legal entity** (if you use them), **address**,
   **maps link**, and **phone**.
3. Save.

> ⚠️ **The branch phone matters.** Portal bookings send their confirmation link to the **branch
> phone over WhatsApp**, and membership expiry/notification messages use it too. Set a real,
> WhatsApp-capable number.

![Branches — one row per outlet.](images/owner-branches.png)

### 4.3 Catalog — categories & brands
**Sidebar → Catalog** (`/dashboard/catalog`). Create the **product categories** and **brands** you'll
tag services and products with.

![Catalog — categories and brands.](images/owner-catalog.png)

### 4.4 Services — your sellable menu
**Sidebar → Services** (`/dashboard/services`). This is what appears on the POS and public eMenu.

1. Click **+ Add Service**.
2. Give it a **business unit** — **AIRE** (car wash) or **LEAD** (detailing) — a **category**, and a
   **price**. Optionally scope it to specific branches.
3. Optionally attach a **Recipe** (the **Recipe** action on each row) — see §7.
4. **Active** services show on the POS; inactive ones are hidden.

![Services — the sellable menu. Each row has a Recipe, Edit and Delete action; UNIT is AIRE or LEAD.](images/owner-services.png)

### 4.5 Products (retail items)
**Sidebar → Products** (`/dashboard/products`). Physical goods you resell (e.g. air fresheners).
Add name, category, price, and stock behaviour.

![Products — retail goods.](images/owner-products.png)

### 4.6 Payment methods (the POS buttons)
**Sidebar → Payment Methods** (`/dashboard/payment-methods`). Define the payment buttons cashiers see
per branch — cash, QRIS, EDC, card, transfer — each with a colour/logo.

![Payment methods — the buttons shown at checkout.](images/owner-payment-methods.png)

### 4.7 Payment gateway (online payments)
**Sidebar → Payment Gateway** (`/dashboard/payment-settings`). Choose your provider (**Xendit /
Midtrans / Stripe**) and enter live keys — or switch on **Sandbox** to demo the full QRIS flow
without a real gateway. Secrets are stored encrypted.

![Payment gateway — provider + sandbox/live keys.](images/owner-payment-settings.png)

### 4.8 Users & roles (staff logins)
**Sidebar → Users & Roles** (`/dashboard/users`). Create logins for your staff.

1. Click **+ Add** (or **Invite**).
2. Enter their details and assign a **role** — a base role (**Outlet Admin** or **Cashier**) or a
   **custom role** with specific permissions.
3. Place them in **one or more branches**.

![Users & roles — staff logins, roles and branch placement.](images/owner-users.png)

### 4.9 Vehicle catalog
**Sidebar → Vehicles** (`/dashboard/vehicles`). The brand → type lists that power the vehicle
dropdowns at the POS and kiosk. Comes pre-seeded for the Indonesian market; edit as needed.

![Vehicle catalog — brand → type dropdown data.](images/owner-vehicles.png)

### 4.10 Legal entities (optional)
**Sidebar → Legal Entities** (`/dashboard/legal-entities`). If you invoice under one or more
companies (PT), record them here and assign each branch to one.

![Legal entities.](images/owner-legal-entities.png)

---

## 5. Customers, memberships & bookings

### 5.1 Customers & CRM
**Sidebar → Customers & CRM** (`/dashboard/crm`). The directory of **every** customer — members and
non-members — with new-customer growth. Each row shows a **membership badge** (Member / grace /
suspended / past member, or plain Customer). You can **Edit** and **Delete** a customer here; deep
membership management (renew, suspend, cards, history) lives on the **Memberships → Members** tab.

![Customers & CRM — the full customer directory with membership badges.](images/owner-crm.png)

### 5.2 Memberships
**Sidebar → Memberships** (`/dashboard/memberships`). Three tabs:

![Memberships → Plans. Tabs across the top: Plans · Members · Cards.](images/owner-memberships.png)

- **Plans** — create membership plans. Click **+ Add Plan** and set: price, duration
  (1 / 3 / 6 / 12 months), **usage quota** (max uses), **daily limit**, **max plates**, the
  **free washes** and **discounted services** (a % per service), a **WhatsApp welcome** toggle,
  which **branches** it's available at, and an optional cross-branch **settlement amount**.
- **Members** — every membership ever sold, with a status filter and search. Click a member to open
  their detail: card preview, plan/period/uses, event **history**, and the **Print card / Renew /
  Suspend / Reactivate** actions.
- **Cards** — design the printable card (drag fields, upload front/back background, choose
  number/barcode/QR, fonts and colours). Also at `/dashboard/membership-card`.

![Membership card designer.](images/owner-membership-card.png)

> **How the membership lifecycle works** (sale → activate → benefits → grace → revoked → renewal,
> plus the 12-digit number and cross-branch settlement) is documented in full in
> [06 · Membership lifecycle](../tech/06-membership-lifecycle.md). **Short version:** benefits apply
> only while a membership is truly **active**; after the end date it enters a **14-day grace** window
> (renewable, but no benefits), then becomes **revoked**. Renewal always takes **payment first** and
> only extends once paid.

### 5.3 Bookings
**Sidebar → Bookings** (`/dashboard/bookings`). Create and confirm appointments. Bookings that
customers request from the member portal land here; **confirm** one to drop that car onto the branch
queue for its time slot (the customer is notified over WhatsApp).

![Bookings — appointments and portal requests.](images/owner-bookings.png)

---

## 6. Vouchers & promotions

### 6.1 Vouchers
**Sidebar → Vouchers** (`/dashboard/vouchers`). Define voucher-pack templates and sell/issue code
packs (a parent code + child codes, delivered over WhatsApp). There are also shareable digital
tickets with human-readable codes.

![Vouchers — pack templates and issued codes.](images/owner-vouchers.png)

### 6.2 Promotions
**Sidebar → Promotions** (`/dashboard/promotions`). Time-boxed campaigns: a fixed or percentage
discount, a free product, a free voucher, or a future-discount — with optional trigger products,
branch scope, and a quota.

![Promotions — time-boxed campaigns.](images/owner-promotions.png)

---

## 7. Inventory, recipes, COGS & finance

This chain is how airin tracks **true profit**, not just revenue.

### 7.1 Inventory
**Sidebar → Inventory** (`/dashboard/inventory`). Stock items per branch. Add items, **adjust**
in/out, and set **unit conversions** (buy in kg, consume in grams).

![Inventory — per-branch stock with adjustments.](images/owner-inventory.png)

### 7.2 Recipes (attached to services)
On any service (**Services → Recipe**), define what it **consumes**: the inventory items used per
unit, plus non-physical cost lines (tax, profit, water, electricity — as a fixed amount or a % of
price). When that service sells, stock is deducted automatically and the unit cost is **frozen onto
the order line**, so your margins stay accurate even if you change the recipe later.

### 7.3 Procurement
**Sidebar → Procurement** (`/dashboard/procurement`). Suppliers and purchase orders. **Receiving** a
PO auto-restocks the linked inventory items.

![Procurement — suppliers and purchase orders.](images/owner-procurement.png)

### 7.4 Stock opname (physical count)
**Sidebar → Stock Opname** (`/dashboard/opname`). Start a count → enter the **physical counts** →
**Close** to reconcile the system to reality and record the variance.

![Stock opname — physical count and reconciliation.](images/owner-opname.png)

### 7.5 COGS & P&L
**Sidebar → COGS** (`/dashboard/cogs`). The true profit view: **revenue − cost of goods − expenses**,
per-product margin, and inventory variance.

![COGS & P&L — true profit and per-product margin.](images/owner-cogs.png)

### 7.6 Finance
**Sidebar → Finance** (`/dashboard/finance`). Revenue / expense / net-profit summary with a forecast,
and **+ Record expense** to log outgoing costs by category. (Note: this page is *revenue − expenses*;
**COGS** is the page that also subtracts cost of goods.)

![Finance — revenue, expenses, net profit, and record-expense.](images/owner-finance.png)

### 7.7 Settlement (cross-branch)
**Sidebar → Settlement** (`/dashboard/settlement`). When a member washes at a branch other than their
"home" branch, one branch owes the other. Settle/payout a branch pair here and see the history.

![Settlement — cross-branch amounts owed.](images/owner-settlement.png)

### 7.8 Accounting
**Sidebar → Accounting** (`/dashboard/accounting`). The double-entry ledger behind the numbers
(journal entries posted automatically by sales, opname, payroll, etc.).

![Accounting — the ledger.](images/owner-accounting.png)

---

## 8. Reporting

- **Overview** (`/dashboard`) — headline KPIs, revenue forecast vs target, AI proposals, and quick
  links, with a branch filter.
- **Reports** (`/dashboard/reports`) — consolidated metrics (KPIs, AIRE/LEAD split, payment methods,
  top services, daily sales, per-shift cash) with **PDF/CSV export**.

  ![Reports — consolidated metrics with export.](images/owner-reports.png)

- **Transactions** (`/dashboard/transactions`) — charts plus the orders table (view / edit / void),
  with **Excel + PDF export**.

  ![Transactions — orders table with charts and export.](images/owner-transactions.png)

- **Sales & Leads** (`/dashboard/sales`) — attainment vs a monthly **target you set**, a run-rate
  forecast, and a simple lead pipeline (new → contacted → won).

  ![Sales & Leads — target attainment and pipeline.](images/owner-sales.png)

- **Invoices** (`/dashboard/invoices`) — print/save A4 invoices for paid orders.

  ![Invoices — printable A4 invoices.](images/owner-invoices.png)

- **Refunds** (`/dashboard/refunds`), **Feedback & NPS** (`/dashboard/feedback`), and
  **P&L** (`/dashboard/pnl`) round out the reporting set.

  ![Feedback & NPS.](images/owner-feedback.png)

---

## 9. People — HR & payroll

- **HR** (`/dashboard/hr`) — employees (link a login to an employee record), schedules, clock in/out,
  leave approvals, and holidays.

  ![HR — employees, schedules, clock-in, leave.](images/owner-hr.png)

- **Payroll** (`/dashboard/payroll`) — generate a payroll run for a period (base salary + bonuses −
  deductions − advances − loan installments − unpaid leave), review payslips, **Finalize** to lock,
  and **export** payslips as CSV.

  ![Payroll — runs, payslips, finalize.](images/owner-payroll.png)

- **Commission** (`/dashboard/commission`) — per-staff commission rules and payouts.

  ![Commission — per-staff rules and payouts.](images/owner-commission.png)

---

## 10. AI assistant & WhatsApp

- **AI Assistant** (`/dashboard/assistant`) — chat with your business co-pilot. It can read your data
  and, **with your approval**, take actions (create a campaign, adjust stock, record an expense…).
  In "approval required" mode, every action waits for your sign-off.

  ![AI Assistant — your business co-pilot.](images/owner-assistant.png)

- **Agent Workflow** (`/dashboard/agents`) — manage AI **personas** and choose **routing**: the
  built-in engine, or a published **n8n flow** (generate a bridge token if using n8n).

  ![Agent Workflow — personas and routing.](images/owner-agents.png)

- **Agentic AI / WhatsApp** (`/dashboard/ai-agent`) — connect WhatsApp (scan the WAHA QR or configure
  Kapso), set the base prompt, product knowledge, escalation number, a daily cap, and toggle
  auto-reply.

  ![Agentic AI / WhatsApp — connect and configure the WhatsApp agent.](images/owner-ai-agent.png)

- **Conversations** (`/dashboard/conversations`) — the live customer ↔ AI chat log: read threads,
  toggle AI per conversation, reply manually, or summarize.

  ![Conversations — live customer ↔ AI threads.](images/owner-conversations.png)

- **Monitoring** (`/dashboard/monitoring`) — real-time AI usage (invocations, errors, tokens).

  ![AI monitoring — usage and errors.](images/owner-monitoring.png)

> **Data safety:** the WhatsApp agent can only ever read **that one customer's** own data plus public
> info (prices, plans, promos). It cannot reveal other customers or your financials — even if a
> customer tries to trick it.

---

## 11. Settings & configuration

**Sidebar → Settings** (`/dashboard/settings`). Your tenant identity (read-only **tenant code**),
**branding**, WhatsApp/AI toggles and LLM provider/key, and device discovery. Secrets are encrypted.

![Settings — identity, branding, AI/WhatsApp, devices.](images/owner-settings.png)

Related setup pages:
- **Finance setup** (`/dashboard/finance-setup`) — one-click provisioning of finance defaults,
  payroll, PPN tax and pay-day automation.

  ![Finance setup — one-click finance/payroll provisioning.](images/owner-finance-setup.png)

- **POS Terminals** (`/dashboard/pos-devices`) — register the tablets/PCs that run the POS. Each
  terminal opens its **launch URL** once to become an authorized register (see the
  [Employee manual §1](03-employee-manual.md)).

  ![POS Terminals — register the devices that run the POS.](images/owner-pos-devices.png)

- **Kiosks** (`/dashboard/kiosks`) — register the self-service kiosk tablets the same way.

  ![Kiosks — register self-service kiosk devices.](images/owner-kiosks.png)

- **Designers** — customise the printable **receipt**, **invoice**, **membership card**, **barcode**,
  and **report** layouts (`/dashboard/receipt-designer`, `invoice-designer`, `barcode-designer`,
  `report-designer`).

  ![Receipt/invoice/label designers.](images/owner-invoice-designer.png)

- **Devices / Topology / CCTV** (`/dashboard/devices`, `topology`, `cctv`) — the on-premise
  branch-bridge IoT and CCTV integration, if you use it.

---

## 12. Tips & troubleshooting

- **A menu is missing?** That module was turned off by the platform administrator — the default is
  everything on. Ask them to enable it.
- **Two business units.** Tag every service correctly as **AIRE** (wash) or **LEAD** (detailing) —
  reports, payment channels and revenue split all rely on it.
- **Branch phone numbers** must be set (and WhatsApp connected) for portal bookings and
  expiry/notification messages to work.
- **WhatsApp features** need a **connected** WAHA/Kapso session (Agentic AI page).
- **Numbers look wrong?** Remember: **Finance** = revenue − expenses; **COGS** = revenue − cost of
  goods − expenses. Use COGS for true margin.
- **Member pricing not applying at the counter?** The membership may be in grace or expired — check
  the member's detail on **Memberships → Members**.

**Recommended setup order (first week):**
Branding → Branches → Catalog → Services → Payment methods → Payment gateway → Users & roles →
Vehicle catalog → Membership plans → (Inventory + Recipes if you track COGS) → Finance setup →
register POS terminals & kiosks.
