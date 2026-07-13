-- Migration: 064_wa_booking_approvals
-- Description: Audit trail for booking approvals resolved via the WhatsApp AI
--   agent flow. Every time a proposed booking is accepted/rejected — whether by a
--   staff TERIMA/TOLAK reply on WhatsApp or by an Approve/Reject click in the
--   dashboard — we record who decided, through which channel, and when.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS wa_booking_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID,                                    -- the booking that was decided
  summary TEXT,                                       -- human-readable "service — date"
  customer_phone VARCHAR(32),
  decision VARCHAR(12) NOT NULL CHECK (decision IN ('confirmed', 'cancelled')),
  channel VARCHAR(12) NOT NULL CHECK (channel IN ('whatsapp', 'dashboard', 'system')),
  decided_by VARCHAR(120),                            -- staff phone (whatsapp), user id (dashboard), or 'sla' (system)
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_booking_approvals_tenant ON wa_booking_approvals(tenant_id, decided_at DESC);

COMMIT;
