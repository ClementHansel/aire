-- Migration: 077_wa_conversation_identity
-- Description: Let the WhatsApp agent remember WHO it is talking to, per chat.
--   WhatsApp increasingly delivers senders as opaque privacy "@lid" ids (no phone),
--   so the agent can't match them to a customer by number. Instead, Irene asks for
--   an identifier (phone / membership number / plate) once per chat; when the
--   customer answers we resolve the customer and BIND them to the conversation here,
--   so every later turn is personalised — even over an @lid address.
-- Created at: 2026-07-20

BEGIN;

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS identified_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identified_phone varchar(32),
  ADD COLUMN IF NOT EXISTS identity_prompted boolean NOT NULL DEFAULT false;

-- Fast lookup of a conversation's bound customer.
CREATE INDEX IF NOT EXISTS idx_wa_conv_identified_customer
  ON wa_conversations (identified_customer_id)
  WHERE identified_customer_id IS NOT NULL;

COMMIT;
