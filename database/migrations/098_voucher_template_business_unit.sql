-- Migration: 098_voucher_template_business_unit
-- Description: A voucher pack belongs to a business unit (AIRIN-180).
--
--   Every other sellable thing already declares which line of business it
--   belongs to — `services.business_unit`, `payment_methods.business_unit`,
--   and the order itself. Voucher packs did not, so the dashboard's "New
--   Service Pack" form had no unit to pick and a pack sale could only ever be
--   booked as AIRE. For a tenant running two lines (AIRE washing, LEAD
--   detailing) that quietly credited LEAD's pack revenue to AIRE, and there was
--   no way to correct it from the UI.
--
--   Matches the shape services already use: NOT NULL with an 'AIRE' default, so
--   existing rows keep working and the column is safe to read unconditionally.
--   Deliberately NOT a foreign key to `business_units` — 096 established the
--   code (not the id) as the value every `business_unit` column carries, and
--   these columns stay loosely coupled so renaming or retiring a unit cannot
--   cascade into historical rows.

ALTER TABLE voucher_templates
  ADD COLUMN IF NOT EXISTS business_unit VARCHAR(10) NOT NULL DEFAULT 'AIRE';

-- Packs restricted to specific branches inherit the unit their branches
-- actually trade under, where that is unambiguous; everything else keeps the
-- 'AIRE' default. Without this every pre-existing LEAD pack would have to be
-- re-picked by hand.
UPDATE voucher_templates vt
   SET business_unit = sub.unit
  FROM (
    SELECT t.id,
           MIN(s.business_unit) AS unit
      FROM voucher_templates t
      JOIN services s ON s.id = ANY(t.service_ids)
     WHERE t.service_ids IS NOT NULL
     GROUP BY t.id
    HAVING COUNT(DISTINCT s.business_unit) = 1
  ) AS sub
 WHERE vt.id = sub.id
   AND vt.business_unit <> sub.unit;

COMMENT ON COLUMN voucher_templates.business_unit IS
  'Line of business this pack is sold under; matches business_units.code (AIRIN-180).';
