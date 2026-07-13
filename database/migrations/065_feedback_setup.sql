-- Migration: 065_feedback_setup
-- Description: Make the customer-feedback SETUP fully configurable and honored.
--   The feedback config (tenants.settings.feedback) now also carries a
--   configurable question set, link expiry, send delay, and low-rating/detractor
--   alert threshold — all read by the feedback service. This migration adds the
--   two columns those features need:
--     * feedback_requests.send_after  — when a delayed survey becomes due to send.
--       Requests with sendDelayMinutes > 0 are created with sent_at = NULL and a
--       future send_after; a periodic sweep dispatches them once due.
--     * feedback_responses.answers    — the full submitted answer map keyed by
--       question id (custom questions included). The legacy rating/nps/comment
--       columns are still populated for the standard questions so existing
--       aggregates keep working.
-- Created at: 2026-07-13

BEGIN;

ALTER TABLE feedback_requests  ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ;
ALTER TABLE feedback_responses ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}';

-- Sweep lookup: pending requests whose delayed send has come due.
CREATE INDEX IF NOT EXISTS idx_feedback_req_due
  ON feedback_requests(send_after)
  WHERE sent_at IS NULL;

COMMIT;
