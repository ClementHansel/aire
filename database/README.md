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

# Seed development data
pnpm --filter @aire/database seed

# Full reset (development only!)
pnpm --filter @aire/database reset
```

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
