-- Migration: 084_order_customer_link_and_plate
-- Description: Two long-standing data gaps on `orders`, both from the POS
--   checkout path never writing fields the rest of the app reads.
--
--   1. AIRIN-112 — POS checkout never created a customer row and left
--      orders.customer_id NULL, so walk-ins never appeared in CRM. Worse, the
--      CRM list derives total_visits / last_visit_date by joining orders on
--      customer_id, so those columns read 0 for EVERY customer, including real
--      members. This backfills customer_id by matching the order's stored phone
--      to customers.phone_normalized, and creates customer rows for POS buyers
--      who have no record at all.
--
--   2. AIRIN-117 — license_plate was stored exactly as typed, so "B 8882 CST"
--      and "B8882CST" were different values and a search by either spelling
--      missed the other. Adds plate_normalized (whitespace stripped, uppercased
--      — the same rule as normalizePlate() in @aire/shared and the same shape as
--      membership_plates.plate_normalized) and backfills it.
--
--   Both are additive. Existing reads of license_plate / customer_name are
--   untouched: license_plate stays the as-typed receipt value.
-- Created at: 2026-07-29

BEGIN;

-- ─── 1. Plate normalization ───────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS plate_normalized VARCHAR(20);

-- Same transform as normalizePlate(): strip ALL whitespace, uppercase. NULLIF
-- keeps rows whose plate was blank/whitespace-only as NULL rather than ''.
UPDATE orders
   SET plate_normalized = NULLIF(UPPER(REGEXP_REPLACE(license_plate, '\s', '', 'g')), '')
 WHERE license_plate IS NOT NULL
   AND plate_normalized IS NULL;

-- Plate lookup is a POS hot path (find this car's history at the counter).
CREATE INDEX IF NOT EXISTS idx_orders_plate_normalized
  ON orders(tenant_id, plate_normalized)
  WHERE plate_normalized IS NOT NULL;

-- ─── 2. Order → customer linkage ──────────────────────────────────────────────

-- customer_id already exists on orders (001_initial_schema) but was never
-- populated by the POS path.

-- SQL mirror of normalizePhone() from @aire/shared: strip non-digits, map a
-- leading 0 to 62, and require MIN_PHONE_LENGTH (10) digits. Returns NULL for
-- anything that isn't a real Indonesian number.
--
-- The validity check is the important part. Walk-in sentinels ('', '0000', and
-- short junk emitted by older flows and e2e fixtures) all normalize to the same
-- value, so linking on raw digits would merge every anonymous customer into ONE
-- CRM record carrying a fabricated visit history — and would mint a bogus
-- "Walk-in" customer from test rows. Anonymous orders must stay unlinked.
CREATE OR REPLACE FUNCTION aire_normalize_phone(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d IS NULL THEN NULL
    WHEN LEFT(d, 2) = '62' AND LENGTH(d) >= 10 THEN d
    WHEN LEFT(d, 1) = '0'  AND LENGTH('62' || SUBSTRING(d FROM 2)) >= 10 THEN '62' || SUBSTRING(d FROM 2)
    ELSE NULL
  END
  FROM (SELECT NULLIF(REGEXP_REPLACE(COALESCE(raw, ''), '\D', '', 'g'), '') AS d) x;
$$;

-- 2a. Link orders whose phone already matches an existing customer.
UPDATE orders o
   SET customer_id = c.id
  FROM customers c
 WHERE o.customer_id IS NULL
   AND o.tenant_id = c.tenant_id
   AND aire_normalize_phone(o.customer_phone) IS NOT NULL
   AND aire_normalize_phone(o.customer_phone) = aire_normalize_phone(c.phone);

-- 2b. Create customers for POS buyers who have no record at all, then link.
--     DISTINCT ON picks the most recent spelling of the name per phone.
WITH unlinked AS (
  SELECT DISTINCT ON (tenant_id, norm)
         tenant_id, norm, customer_name, customer_phone
    FROM (
      SELECT tenant_id,
             customer_name,
             customer_phone,
             aire_normalize_phone(customer_phone) AS norm,
             created_at
        FROM orders
       WHERE customer_id IS NULL
         AND COALESCE(NULLIF(TRIM(customer_name), ''), '') <> ''
    ) s
   WHERE norm IS NOT NULL
   ORDER BY tenant_id, norm, created_at DESC
),
created AS (
  INSERT INTO customers (tenant_id, name, phone, phone_normalized)
  SELECT tenant_id, customer_name, customer_phone, norm
    FROM unlinked
  ON CONFLICT (tenant_id, phone_normalized) DO NOTHING
  RETURNING id, tenant_id, phone_normalized
)
UPDATE orders o
   SET customer_id = created.id
  FROM created
 WHERE o.customer_id IS NULL
   AND o.tenant_id = created.tenant_id
   AND aire_normalize_phone(o.customer_phone) = created.phone_normalized;

-- Re-run 2a for anything ON CONFLICT skipped above (a customer that already
-- existed under a differently-formatted phone).
UPDATE orders o
   SET customer_id = c.id
  FROM customers c
 WHERE o.customer_id IS NULL
   AND o.tenant_id = c.tenant_id
   AND aire_normalize_phone(o.customer_phone) IS NOT NULL
   AND aire_normalize_phone(o.customer_phone) = aire_normalize_phone(c.phone);

-- Helper was only needed for the backfill above.
DROP FUNCTION IF EXISTS aire_normalize_phone(TEXT);

-- CRM visit/spend aggregates scan orders by customer.
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders(tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;

COMMIT;
