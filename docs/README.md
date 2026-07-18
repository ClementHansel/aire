# airin (AIRE) — Documentation

**airin** is a multi-tenant SaaS operations platform for car-wash and automotive-service
businesses. One deployment serves many independent businesses (tenants); each tenant runs
its branches, staff, point-of-sale, membership program, queue, inventory/COGS, finance, HR,
customer self-service (kiosk + portal), and AI/WhatsApp automation in fully isolated data.

> **Naming:** the product/brand shown to end-users is **airin**. "AIRE" is the internal code
> name and also the name of the car-wash **business unit** (AIRE = car wash, LEAD = detailing).
> The two are unrelated — don't confuse the app name with the business-unit tag on orders.

---

## 1. Technical documentation

| Doc | Contents |
|-----|----------|
| [01 · Architecture & Stack](tech/01-architecture.md) | System overview, full tech stack, service topology, infrastructure, deployment, integrations (WAHA, n8n, MinIO, MQTT, payments) |
| [02 · Backend](tech/02-backend.md) | NestJS-on-Express stack, module map, auth/roles/multi-tenancy, all core flows (order, payment, shift, queue, COGS, membership, portal, kiosk, AI) |
| [03 · Frontend](tech/03-frontend.md) | Next.js App Router stack, routing map, state/contexts, API client, i18n/branding/theming, key UI flows |
| [04 · Database](tech/04-database.md) | PostgreSQL stack, migration system, full table catalog by domain, tenancy model, key enums/constraints |
| [05 · API Reference](tech/05-api-reference.md) | Every HTTP endpoint grouped by module, with required role and purpose |
| [06 · Membership — End-to-End](tech/06-membership-lifecycle.md) | The complete membership flow and status cycle, sale → activation → benefits → grace → revoked → renewal, identity numbering, settlement, portal |
| [07 · Branch-Bridge Protocol](tech/07-branch-bridge-protocol.md) | The on-premise branch-bridge agent: device discovery, live/recorded CCTV, and how it talks to the cloud |
| [08 · Device Registry & Topology](tech/08-device-registry-topology.md) | The device registry, network topology model, and how discovered IoT/CCTV devices are mapped per branch |

## 2. User manuals (by point of view)

Step-by-step guides with **embedded screenshots** (captured from the running app). Start at the
[manuals index](manuals/README.md).

| Manual | Audience |
|--------|----------|
| [Platform Super-Admin](manuals/01-superadmin-manual.md) | The platform operator who manages tenants, modules, pricing, and platform health |
| [Tenant Owner / Manager](manuals/02-tenant-owner-manual.md) | The business owner who configures branches, catalog, staff, memberships, finance, and AI |
| [Employee (Cashier / Outlet Admin / HR)](manuals/03-employee-manual.md) | Front-line staff who run POS, queue, shifts, memberships, inventory, and HR |
| [Customer](manuals/04-customer-manual.md) | The end customer using the eMenu, kiosk, member portal, queue check, and bookings |

## 3. Legacy / supporting docs

- [`TECHNICAL.md`](TECHNICAL.md) — earlier architecture note (partly superseded by `tech/`)
- [`INTEGRATION.md`](INTEGRATION.md) — configuring WhatsApp, LLM, payments, branches via the UI
- [`n8n-agent-builder.md`](n8n-agent-builder.md) — the hosted n8n visual agent-builder integration
- [`../AIRE-Consolidated-Requirements.md`](../AIRE-Consolidated-Requirements.md) — product requirements & locked decisions
- [`../AIRE-Progress-Tracker.md`](../AIRE-Progress-Tracker.md) — build checklist

---

## Quick orientation

- **Roles (privilege high → low):** `platform_super_admin` → `tenant_owner` → `outlet_admin` → `cashier`.
- **Surfaces:** `/` login · `/hub` launcher · `/dashboard/*` management · `/pos/*` point-of-sale ·
  `/admin/*` platform admin · `/kiosk/*` self-service · `/portal/*` member portal ·
  `/menu/*` public eMenu · `/queue-board/*` TV queue display · `/confirm-booking/*` cashier confirm link.
- **Business units:** every order is tagged **AIRE** (car wash) or **LEAD** (detailing); catalogs,
  payment channels, and revenue reporting are segregated per unit.
- **Demo logins** (seeded, password `password123`): `superadmin@aire.com` (platform admin),
  `owner@demo.com` (tenant owner), `cashier1@demo.com` (cashier, PIN `1234`).
