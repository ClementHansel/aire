# AIRE Database

PostgreSQL database schema with Row Level Security (RLS) for multi-tenant isolation.

## Prerequisites

- PostgreSQL 15+ (required for `gen_random_uuid()`)
- Create a database: `createdb aire_dev`

## Setup

```bash
# Install dependencies
pnpm install

# Run migrations
pnpm --filter @aire/database migrate

# Check migration status
pnpm --filter @aire/database migrate:status

# Seed development data (base tenant, outlets, services, demo logins)
pnpm --filter @aire/database seed

# Seed 6 months of per-branch customer/sales history
pnpm --filter @aire/database seed:history

# Full reset (development only!)
pnpm --filter @aire/database reset
```

### Comprehensive demo seed (`seed-demo-full.sql`)

`seed.ts` + `seed-history.ts` populate the tenant, outlets, services, customers,
orders and memberships — but leave every other module empty. `seed-demo-full.sql`
fills the rest so the whole app demos with live-looking data:

- **HR / payroll** — links every staff login to an `employees` record (**required**:
  without it, cashier login lands on `/employee` and `GET /me/home` returns 403
  *"This login is not linked to an employee record"*), plus schedules, attendance,
  payslips, a payroll run, leave, loans, holidays, custom roles, clock-in shifts.
- **Inventory / COGS** — product categories, stocked items, movements, UOM
  conversions, cost components, service recipes (BOM), a closed stock opname.
- **Procurement** — suppliers, product brands, purchase orders, goods receipts.
- **Finance / accounting** — chart of accounts, periods, finance settings, balanced
  journal entries + lines, expenses, inter-branch settlements, petty cash.
- **Sales / CRM / marketing** — sales targets, commission accruals, leads,
  promotions + grants, a campaign.
- **Feedback / revenue-ops** — NPS/CSAT feedback config + responses, refunds,
  e-Faktur tax invoices, a WhatsApp broadcast campaign.
- **Ops / vouchers** — legal entities (PT) assigned to branches, bookings, order
  status logs, voucher packs/codes and outlet voucher books/tickets/counters.

It targets the demo tenant `11111111-1111-1111-1111-111111111111`, is idempotent
(every block guards on existing rows), and runs in one transaction:

```bash
# Local docker-compose
cat database/seed-demo-full.sql | docker exec -i aire-postgres psql -U aire -d aire -v ON_ERROR_STOP=1
```

Prerequisites: run **after** migrations + `seed` + `seed:history` (it resolves
outlets, services, staff users, customers and orders that those create).

## Migration Files

Migrations are plain SQL files in `migrations/` directory, applied in alphabetical order:

| File | Description |
|------|-------------|
| `001_initial_schema.sql` | All tables with constraints and relationships |
| `002_indexes.sql` | Performance indexes |
| `003_rls_policies.sql` | Row Level Security policies for tenant isolation |
| `004_updated_at_trigger.sql` | Auto-update `updated_at` on row changes |

## RLS Architecture

Every request sets session variables before executing queries:

```sql
SET app.tenant_id = '<uuid>';   -- Required for all queries
SET app.outlet_id = '<uuid>';   -- Required for outlet-scoped roles
SET app.role = '<role_name>';   -- Determines outlet scoping behavior
```

### Policy Layers

1. **Tenant Isolation** - All tables with `tenant_id` are filtered to the current tenant
2. **Outlet Scoping** - Tables with `outlet_id` are further filtered for `cashier`/`outlet_admin` roles
3. **Cross-Outlet** - Customers, memberships, and vouchers are visible across outlets within a tenant

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/aire_dev` | Connection string |
