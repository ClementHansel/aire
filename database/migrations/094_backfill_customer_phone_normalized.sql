-- Migration: 094_backfill_customer_phone_normalized
-- Description: AIRIN-154 — "Tidak bisa find by phone number untuk membership
--   status grace dan revoked."
--
--   customers.phone_normalized is what every phone lookup keys on, but rows
--   written by the demo-history seeder carried its cleanup marker ('SEEDH…')
--   there instead of a normalized number. Those customers hold most of the
--   grace/revoked memberships, so a cashier looking at an expired member on
--   screen was still told "Customer not found" when typing their phone.
--
--   This rewrites any phone_normalized that does not match what normalizePhone()
--   would derive from the stored phone. The service now also falls back to
--   normalising in SQL, so the fix does not depend on this backfill having run —
--   but leaving wrong values in the column would keep the index useless and let
--   the next writer trip over the same mismatch.
-- Created at: 2026-08-12

BEGIN;

UPDATE customers c
   SET phone_normalized = sub.derived,
       updated_at = NOW()
  FROM (
    SELECT id,
           CASE
             WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') LIKE '0%'
               THEN '62' || substring(regexp_replace(COALESCE(phone, ''), '\D', '', 'g') from 2)
             ELSE regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
           END AS derived
      FROM customers
  ) AS sub
 WHERE c.id = sub.id
   -- Only rows whose stored value is a usable Indonesian number, and only where
   -- the column actually disagrees with it. A customer with no real phone keeps
   -- whatever they had — blanking it could collide two anonymous walk-ins onto
   -- one key.
   AND sub.derived LIKE '62%'
   AND length(sub.derived) >= 8
   AND COALESCE(c.phone_normalized, '') <> sub.derived
   -- Never merge two customers onto one normalized phone: skip a row whose
   -- derived value is already taken by a different customer in the same tenant.
   AND NOT EXISTS (
     SELECT 1 FROM customers other
      WHERE other.tenant_id = c.tenant_id
        AND other.id <> c.id
        AND other.phone_normalized = sub.derived
   );

COMMIT;
