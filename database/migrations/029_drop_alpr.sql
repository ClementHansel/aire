-- =============================================================================
-- 029: Drop ALPR (automatic license-plate recognition)
--
-- ALPR was removed from the product. This drops the detections table on
-- already-deployed databases. Fresh installs never create it (removed from
-- 001/002/003). Manual vehicle-plate entry for memberships is unaffected —
-- that lives in membership_plates / orders.license_plate and stays.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS alpr_detections CASCADE;

COMMIT;
