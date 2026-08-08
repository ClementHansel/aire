# airin — User Manuals

Practical, **step-by-step** guides with **screenshots**, written for each kind of user. Pick the one
that matches your role and follow it top to bottom.

| Manual | You are… | You mainly use… |
|--------|----------|-----------------|
| [1 · Platform Super-Admin](01-superadmin-manual.md) | The operator of the whole airin platform | `/admin` |
| [2 · Tenant Owner / Manager](02-tenant-owner-manual.md) | The owner/manager of one business | `/dashboard` (incl. Branches) |
| [3 · Employee](03-employee-manual.md) | Cashier, outlet admin, or HR staff | `/pos`, parts of `/dashboard` |
| [4 · Customer](04-customer-manual.md) | A paying customer of a business | eMenu, kiosk, member portal |
| [5 · Daftar Notifikasi](05-daftar-notifikasi.md) | Any owner rewording the automatic messages | `Settings → Notifications` |

> **5 · Daftar Notifikasi** is a **reference document**, not a walkthrough: it lists all 26 automatic
> messages with their trigger, permitted variables, default wording and a rendered example. The
> walkthrough of the editing screen is [Manual 2 §11.2](02-tenant-owner-manual.md#112-notifications-settings--notifications).
>
> It is **generated** from the notification catalogue in code
> (`pnpm --filter @aire/backend doc:notifications`). Edit the catalogue, not the Markdown — a hand
> edit is overwritten on the next run and, worse, would describe messages the system does not send.

> **Screenshots** live in [`images/`](images/) and are embedded throughout each manual. They were
> captured from the running app, so what you see in the guides matches what you'll see on screen.

---

### The roles, briefly

- **Platform Super-Admin** — runs airin itself: creates businesses (tenants), turns modules on/off,
  sets platform pricing, watches platform health. Not tied to any one business.
- **Tenant Owner** — owns one business: all its branches, staff, catalog, memberships, finance, and
  AI. Full control inside their own business only.
- **Outlet Admin** — manages one or more branches: everything a cashier can do, plus staff, price
  overrides, voids, membership suspend/reactivate, and branch reports.
- **Cashier** — front-line: runs the POS, the arrival queue, shifts, and sells memberships/vouchers.
- **Customer** — no login needed to browse; a WhatsApp one-time code for the member portal.

---

### Signing in

Open the app URL. On a demo system you can click a **quick-login card** (Super Admin / Tenant Owner /
Employee · Cashier), or type your email + password and click **Sign in**. Cashiers land on the POS;
everyone else lands on the **Hub**, a launcher with tiles for **Dashboard**, **Point of Sale**,
**Self-Service Kiosk**, and (super-admins only) **Platform Admin**. Use the **EN / ID** toggle to
switch language anywhere.

![The sign-in screen, with demo quick-login cards and the customer-facing links.](images/00-login.png)

**Demo logins** (password `password123`): `superadmin@aire.com`, `owner@demo.com`,
`cashier1@demo.com` (admin PIN `1234`).
