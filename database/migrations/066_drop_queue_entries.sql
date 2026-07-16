-- 066_drop_queue_entries.sql
-- Remove the legacy `queue_entries` table. It was superseded by `vehicle_queue`
-- (the live resto-style arrival board used by POS, kiosk and booking-confirm).
-- Its only writer was kiosk.service.joinQueue() (a dead, broken INSERT that
-- referenced a non-existent `is_member` column and omitted NOT NULL tenant_id);
-- that endpoint + method have been removed, and the two readers
-- (KioskService.getQueueStatus, CustomerContextService.activeQueue) were
-- repointed to `vehicle_queue`. No FK, view, or trigger references this table.
-- Idempotent + safe: the table is empty.
DROP TABLE IF EXISTS queue_entries CASCADE;
