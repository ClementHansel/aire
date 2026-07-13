-- Migration: 063_wa_pending_booking
-- Description: Two-sided WhatsApp booking approval state on wa_conversations.
--   `pending_booking` (customer side): create_booking PROPOSES here and the
--     customer confirms with YA/BATAL (a human click/confirm on WhatsApp) before
--     anything is written to `bookings`.
--   `pending_staff_ack` (staff side): once the customer confirms, the booking is
--     created as 'booked' and the tenant's escalation number is asked to acknowledge
--     (TERIMA → 'confirmed', TOLAK → 'cancelled'). Stored on the STAFF conversation.
--   Both are single-slot (one active at a time) and cleared on resolution/expiry.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS pending_booking JSONB,
  ADD COLUMN IF NOT EXISTS pending_staff_ack JSONB;

COMMIT;
