-- 045_wa_message_persona.sql
-- Attribute each AI WhatsApp reply to the agent/persona that produced it, so the
-- Conversation Log and AI monitoring can show *which* agent answered (previously
-- only a from_ai boolean was stored). NULL for inbound + human/manual messages.
BEGIN;

ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS persona TEXT;

COMMIT;
