# Historical data seed (6 months of per-branch customer history)

`seed-history.ts` back-fills realistic operating history for **every active branch
(outlet)** of a tenant, so branch-scoped dashboards, reports, and CRM show live data.

It generates, per branch:

- **Customers** with join dates spread across the window (drives the CRM list + the
  customer-growth chart)
- **Orders + order_items + order_tags** dated across the last N months, including a
  few dated **today** (revenue, daily/weekly/monthly series, service & payment-method
  breakdowns, business-unit split)
- **Memberships (+ plates + usages)** for ~25% of customers (member metrics, CRM)
- **One cashier user per branch** (order operator / salesperson attribution)

## Prerequisites (on the VPS)

1. The database is already migrated **and** base-seeded — i.e. the tenant, its
   outlets/branches, the service catalog, and membership plans already exist.
   (The seed reads those; it does not create branches or services.)
2. Node 20+ and `pnpm`, with deps installed so `pg`, `bcryptjs`, `tsx` resolve:
   ```bash
   pnpm install
   ```

## Run it

Use the **same `DATABASE_URL` your backend uses** on the VPS, and set `TENANT_ID`
to the tenant you want to populate.

**Option A — on the VPS host** (Node + pnpm available):
```bash
cd /path/to/aire
DATABASE_URL="postgresql://aire:<password>@localhost:<port>/aire" \
TENANT_ID="11111111-1111-1111-1111-111111111111" \
pnpm --filter @aire/database seed:history
```

**Option B — via docker compose** (reach Postgres by its service name on the
compose network):
```bash
docker compose run --rm \
  -e DATABASE_URL="postgres://aire:<password>@postgres:5432/aire" \
  -e TENANT_ID="11111111-1111-1111-1111-111111111111" \
  backend pnpm --filter @aire/database seed:history
```

### Tunables (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `DATABASE_URL` | `…@localhost:5432/aire` | connection string |
| `TENANT_ID` | demo tenant | which tenant's branches to fill |
| `SEED_MONTHS` | `6` | history window |
| `SEED_CUSTOMERS_PER_BRANCH` | `45` | customers created per branch |
| `SEED_MEMBER_RATE` | `0.25` | fraction of customers who are members |
| `SEED_LEAD_RATE` | `0.06` | fraction of orders that are LEAD detailing |

## Safety

- **Synthetic data only.** Intended for demo/staging. Confirm you're pointed at the
  right database before running.
- **Idempotent + self-cleaning.** On each run it first deletes only the rows it
  previously created, identified by tags: `order_number LIKE 'SEED-%'`,
  `customers.phone_normalized LIKE 'SEEDH%'`, cashier emails `@seed.aire.local`.
- **Cannot touch real data.** The `SEEDH` marker is non-numeric, so it can never
  match a real customer's (all-digit) normalized phone.

## Verify after running

```sql
-- Orders per branch over the window
SELECT o.name AS branch, COUNT(*) AS orders, SUM(ord.total) AS revenue
FROM orders ord JOIN outlets o ON o.id = ord.outlet_id
WHERE ord.order_number LIKE 'SEED-%'
GROUP BY o.name ORDER BY revenue DESC;
```

## Remove all seeded history (revert)

```sql
DELETE FROM orders      WHERE order_number LIKE 'SEED-%';
DELETE FROM memberships WHERE customer_id IN (SELECT id FROM customers WHERE phone_normalized LIKE 'SEEDH%');
DELETE FROM customers   WHERE phone_normalized LIKE 'SEEDH%';
DELETE FROM users       WHERE email LIKE '%@seed.aire.local';
```
