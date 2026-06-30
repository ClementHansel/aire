-- Migration: 016_wa_conversations
-- Description: Persist customer ↔ AI WhatsApp conversations for the Conversation
--   Log tab (realtime view, start/stop AI per chat, AI summary).
-- Created at: 2026-06-30

BEGIN;

CREATE TABLE IF NOT EXISTS wa_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id VARCHAR(64) NOT NULL,             -- WhatsApp chat id / phone
  customer_name VARCHAR(255),
  customer_phone VARCHAR(32),
  ai_enabled BOOLEAN NOT NULL DEFAULT true, -- per-conversation AI auto-reply switch
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','closed')),
  messages_today INTEGER NOT NULL DEFAULT 0,
  messages_day DATE,
  summary TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_tenant ON wa_conversations(tenant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS wa_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  body TEXT NOT NULL,
  from_ai BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON wa_messages(conversation_id, created_at);

COMMIT;
