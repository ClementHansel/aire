# Platform Super-Admin — User Manual

**Who this is for:** you run the **airin** platform itself. You don't belong to any one
business — you create the businesses (called **tenants**), decide what each one is allowed to use,
set the prices the platform charges them, and keep an eye on the health of everything.

Your workspace is the **Platform Admin** area at `/admin`. Everything in this manual happens there.

> **Important — two different worlds.** The Platform Admin area (`/admin`) is **only** for platform
> super-admins (you). The businesses themselves are run by their owners from a completely separate
> **Dashboard** (`/dashboard`). You create the business here; the owner runs it there. If an owner
> ever says "I can't find the Platform Admin menu", that's expected — they're not supposed to.

---

## Table of contents

1. [Sign in](#1-sign-in)
2. [Get your bearings — the layout](#2-get-your-bearings--the-layout)
3. [The Platform Overview](#3-the-platform-overview)
4. [Create a new business (tenant)](#4-create-a-new-business-tenant)
5. [Open and manage one business](#5-open-and-manage-one-business)
6. [Turn features on and off (modules)](#6-turn-features-on-and-off-modules)
7. [Subscription plans & pricing](#7-subscription-plans--pricing)
8. [Billing & estimated revenue](#8-billing--estimated-revenue)
9. [Monitoring & system health](#9-monitoring--system-health)
10. [AI usage & the AI flow catalog](#10-ai-usage--the-ai-flow-catalog)
11. [Support & impersonation](#11-support--impersonation)
12. [Everyday checklists](#12-everyday-checklists)

---

## 1. Sign in

1. Open the app URL in any browser.
2. On the sign-in screen, either **click the "Super Admin" demo card** (it fills the credentials for
   you) or type your email and password and click **Sign in**.
3. You land on the **Hub**. Click the **Platform Admin** tile to enter `/admin`.

![The sign-in screen. The "Super Admin" quick-login card is top-left; the email/password form is below.](images/00-login.png)

> **Language:** the **EN / ID** toggle (English / Indonesian) is on every screen, including this one.
> Switch any time — it never affects your data.

---

## 2. Get your bearings — the layout

Every Platform Admin page has the same **left sidebar**. It's grouped so related tools sit together:

| Group | Menu items | What they're for |
|-------|-----------|------------------|
| *(top)* | **Hub**, **Overview** | Return to the launcher; the platform dashboard |
| **TENANTS** | **Tenants**, **Support** | Create/manage businesses; help a business in trouble |
| **GROWTH** | **Analytics**, **Billing**, **Subscription Plans**, **AI Usage** | Money & adoption |
| **OPERATIONS** | **Monitoring**, **System Health**, **Agent Flows** | Keep the platform running |
| **PLATFORM** | **Platform Users** | Other admin accounts |

At the **bottom-left** you'll always find your name, the **EN/ID** language toggle, a **Dark mode**
switch, and **Sign out**.

![The Platform Overview with the full admin sidebar on the left.](images/admin-overview.png)

---

## 3. The Platform Overview

**Menu → Overview** (`/admin`). This is your one-glance health check for the whole platform. The
tiles across the top show:

- **Tenants** (total) and **new in 30 days**
- **Active / Suspended** split
- **Outlets** and **Users** across all businesses
- **Customers**, **Orders today**, **Revenue today**, **Revenue 30d (GMV)**
- **Active memberships**, **Estimated MRR** (your recurring subscription revenue — see §8),
  **AI calls (30d)**, **New tenants (30d)**

Below the tiles are two charts (**platform revenue per day** and **new tenants per day**), a
**Recent platform activity** feed (config changes, suspensions, etc.), and **Quick links** into the
deeper pages.

> If any tile shows a soft "requires Platform Super Admin" message, your account isn't a super-admin
> — sign in with a super-admin account.

---

## 4. Create a new business (tenant)

This is the most common thing you'll do. Creating a tenant provisions the whole business and gives
it a permanent **6-character tenant code** (the prefix of every membership number that business will
ever issue — it never changes).

**Step by step:**

1. In the sidebar click **Tenants**. You'll see the list of every business, with search, a status
   filter, and per-row **Edit** / **Suspend** actions.

   ![The Tenants list: every business with status, plan, outlets, users, 30-day orders and revenue.](images/admin-tenants.png)

2. Click **+ Create Tenant** (top-right).
3. Fill in the business name (and any other fields the form asks for), and **choose its subscription
   plan** (see §7 to define plans first). Status defaults to **Active**.
4. Save. The business now exists and has its tenant code.
5. Hand the owner their **first-login credentials** so they can sign in to the **Dashboard** and set
   up branding, branches and staff. (What they do next is the
   [Tenant Owner manual](02-tenant-owner-manual.md).)

> **Businesses can also self-register.** If you send someone to `/register`, they create their own
> tenant + owner login and get a tenant code automatically — you don't have to create it by hand.
> You'll still see them appear in the Tenants list.

---

## 5. Open and manage one business

Click any business name (or **Edit**) in the Tenants list to open its **detail page**
(`/admin/tenants/[id]`). From here you can see its branches, users and stats, and take action:

- **Add branches** for the tenant (useful during onboarding).
- **Toggle feature modules** on/off (see §6).
- **Impersonate the owner** to troubleshoot (see §11).
- **Suspend / Reactivate** the whole business.

**Suspend vs. delete:** always prefer **Suspend**. Suspending blocks the business but keeps all its
history, and you can **Reactivate** it later in one click. Both actions are recorded in the audit
log (who did it, and the before/after state).

![Drilling into one tenant — branches, users, modules and lifecycle actions.](images/admin-tenant-detail.png)

---

## 6. Turn features on and off (modules)

Each business has a set of **feature modules** you can switch on or off. **Everything is ON by
default** — you only turn a module **off** to hide it from that business's dashboard.

**Core areas can never be turned off:** Hub, Overview, Users & Roles, Payment Gateway, and Settings
are always available.

**Toggleable modules:**
Analytics & Reports · Customers & Bookings (CRM) · Memberships · Vouchers · Promotions ·
Catalog & Outlets · Inventory & Procurement · Finance & Settlement · HR & Payroll ·
AI Assistant · WhatsApp AI Agent.

**How to change them:**
1. Open the tenant's **detail page** (§5).
2. Find the **modules** section and flip the toggles.
3. The change is **audited** (before → after) and takes effect the **next time** the owner loads
   their dashboard.

> **Rule of thumb:** the set of modules a business can see should match **what they're paying for**.
> Check this right after onboarding.

---

## 7. Subscription plans & pricing

**Menu → Subscription Plans** (`/admin/plans`). These are the plans **the platform charges the
businesses** — your product's pricing tiers.

![Subscription Plans — the pricing tiers the platform sells to businesses.](images/admin-plans.png)

Each plan has:
- a **code** and **name**
- a **price** and **billing cycle** (monthly or annual)
- the **features** it includes
- **limits** (e.g. number of outlets or users)

**To put a business on a plan:** go to **Tenants → Edit** and pick the plan there.

**Deactivating** a plan stops it being offered to new tenants but leaves businesses already on it
untouched.

> ⚠️ **Don't confuse two kinds of "plan".**
> - **Subscription plans** (here, `/admin/plans`) = what the *platform* charges *businesses*.
> - **Membership plans** (`/dashboard/memberships`, owner-side) = what a *business* sells to *its
>   customers*. You never touch those.

**Menu → Config** (`/admin/config`) holds platform-wide **default plans** and **feature flags**.

---

## 8. Billing & estimated revenue

**Menu → Billing** (`/admin/billing`). This rolls up your recurring revenue by plan.

- **Estimated MRR** = (plan price) × (number of active businesses on that plan). Annual plans are
  divided by 12 so everything is expressed as a monthly figure.
- The same MRR number appears on the Overview.

![Billing — MRR rolled up by subscription plan.](images/admin-billing.png)

---

## 9. Monitoring & system health

- **Menu → Monitoring** (`/admin/monitoring`) — operational metrics (orders, revenue, customers)
  across all businesses. You can view **globally** or pick a single tenant.

  ![Operational monitoring across tenants.](images/admin-monitoring.png)

- **Menu → System Health** (`/admin/health`) — the technical heartbeat: database latency, whether the
  WhatsApp gateway (WAHA) is reachable, entity counts, and — when the server exposes it — a **live
  list of running containers** with their state/health and a **per-container log viewer**.

  ![System Health — database, WhatsApp gateway, and container status.](images/admin-health.png)

- **Menu → Analytics** (`/admin/analytics`) — platform-wide growth and usage charts.

  ![Platform analytics.](images/admin-analytics.png)

---

## 10. AI usage & the AI flow catalog

- **Menu → AI Usage** (`/admin/ai-usage`) — how much AI is being used: number of calls, errors,
  tokens, and the top tools, globally or per tenant.

  ![AI usage — calls, errors, tokens and top tools.](images/admin-ai-usage.png)

- **Menu → Agent Flows** (`/admin/agent-flows`) — the **catalog of AI flows** you publish for
  businesses to use. You design drag-and-drop flows in the hosted **n8n** builder, then **publish**
  each one here (it gets a webhook URL and a kind — WhatsApp or automation). Businesses then simply
  **select** a published flow for their WhatsApp agent — they never get an n8n login. The technical
  note is [n8n-agent-builder.md](../n8n-agent-builder.md).

  ![The published AI flow catalog.](images/admin-agent-flows.png)

---

## 11. Support & impersonation

**Menu → Support** (`/admin/support`). Search for a business, see a **"needs attention"** list, and
reactivate suspended ones quickly.

![Support — find a business and help it.](images/admin-support.png)

**Impersonation** (from a tenant's detail page, §5) logs you into the owner's Dashboard **as that
owner** so you can reproduce exactly what they see.

- Use it for **support only**, not routine work.
- **Every impersonation is logged** (it's in the audit trail).
- When you're done, click **Stop impersonation** to return to your own admin session.

The **audit log** (`/admin/audit`, and each business has its own) records these sensitive actions.

![The audit log of sensitive platform actions.](images/admin-audit.png)

---

## 12. Everyday checklists

**Onboard a new business**
1. **Tenants → + Create Tenant** (or point them at `/register`).
2. Assign the correct **subscription plan**.
3. Open the tenant detail and confirm its **modules** match what they paid for.
4. Give the owner their **first-login credentials** and the
   [Tenant Owner manual](02-tenant-owner-manual.md).

**A business reports a problem**
1. **Support** → search for them.
2. Open the tenant detail → **Impersonate the owner** and reproduce the issue.
3. **Stop impersonation** when done.
4. If needed, check **System Health** and **Monitoring**.

**Weekly platform review**
1. **Overview** — glance at active/suspended, new tenants, MRR.
2. **Billing** — confirm MRR looks right.
3. **System Health** — database + WhatsApp gateway green.
4. **AI Usage** — watch error rates.

> **Golden rules:** prefer **suspend** over delete (reversible, keeps history); use **impersonation**
> sparingly and remember it's logged; keep each business's **modules** aligned with its plan.
