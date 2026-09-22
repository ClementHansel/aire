-- Migration: 105_service_archive_wa_dedup_agent_style
-- Description: Three unrelated defects from the 2026-09-22 client feedback, in
--   one migration because each is a couple of columns.
--
--   1. SERVICES ARCHIVE (AIRE #2 + #3). "Delete" on a service that has ever been
--      sold could only ever flip `is_active = false`, because
--      `order_items.service_id` is ON DELETE RESTRICT and erasing the row would
--      orphan real revenue. After the Jan–Feb history import, nearly every
--      service has order lines, so Delete became a button that visibly did
--      nothing: the row stayed in the list, greyed out. `deleted_at` gives the
--      row the one property the user was actually asking for — it disappears
--      from every catalog surface — while the FK and the sales history stay
--      intact. It is NOT a second `is_active`: inactive means "temporarily not
--      for sale, still in my catalog", archived means "gone from my catalog".
--
--   2. WHATSAPP INBOUND DEDUP (Kalibrasi #2, "AI agent membalas berulang").
--      The webhook ACKs immediately and processes in the background, so a
--      gateway that re-delivers the same message — a WAHA reconnect replay, a
--      retry, or both `message` and `message.any` being subscribed — produced a
--      second full agent run and a second reply. Nothing keyed off the
--      provider's message id, so there was no way to tell a redelivery from a
--      customer who genuinely sent the same text twice. This table is that key.
--
--   3. TENANT-SETTABLE AGENT STYLE (Kalibrasi #3/#4/#5, AIRE #1). Reply length,
--      tone, how strictly the agent must stay inside its knowledge base, and
--      whether a price-quote request goes straight to a human were all
--      hard-coded in `CustomerAgentService.systemPrompt()` — identical for every
--      tenant. Tuning them for Kalibrasi would have changed AIRE's bot too,
--      which is exactly what AIRE #1 asks us not to do. The DEFAULTS below
--      reproduce today's behaviour verbatim, so AIRE is unchanged until someone
--      edits AIRE's own row.
-- Created at: 2026-09-22

BEGIN;

-- ── 1. Services: archive (a delete the user can see) ────────────────────────

ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN services.deleted_at IS
  'Archived-at. Non-NULL = removed from the tenant''s catalog: hidden from the Services page, POS, the AI price tools and every picker, while past order_items keep pointing at it so sales history stays exact. Distinct from is_active, which only means "temporarily not for sale".';

-- Every catalog read filters on this, so keep the live set cheap to scan.
CREATE INDEX IF NOT EXISTS idx_services_tenant_live
  ON services (tenant_id, business_unit, sort_order)
  WHERE deleted_at IS NULL;

-- `services.description` carries what a row's name cannot: the measuring range
-- a calibration price depends on ("-10 to 1000°C"), a package's contents, a
-- unit note. The AI quotes it verbatim alongside the price, which is how a
-- price list with eight "Timbangan" rows stays unambiguous.
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN services.description IS
  'Short qualifier shown with the name wherever the service is quoted — e.g. the measuring range that makes two same-named rows different prices. Surfaced verbatim to the AI; never invented by it.';

-- ── 2. WhatsApp inbound de-duplication ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_inbound_events (
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The gateway's own id for the message (WAHA `payload.id`, Meta/kirimdev
  -- `messages[].id`). Opaque to us; we only ever compare it for equality.
  message_id  TEXT        NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, message_id)
);

COMMENT ON TABLE wa_inbound_events IS
  'Idempotency keys for inbound WhatsApp messages. An INSERT that conflicts means the gateway re-delivered a message we already answered, so the second delivery is dropped instead of producing a second reply. Rows older than a day are pruned — a redelivery never arrives that late, and the table must not grow without bound.';

-- The pruning sweep scans by age, so index by age.
CREATE INDEX IF NOT EXISTS idx_wa_inbound_events_received
  ON wa_inbound_events (received_at);

ALTER TABLE wa_inbound_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_wa_inbound_events ON wa_inbound_events;
CREATE POLICY tenant_isolation_wa_inbound_events ON wa_inbound_events
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ── 3. Tenant-settable agent style, scope and quote handling ────────────────

ALTER TABLE agent_configs
  -- How much the agent says. 'concise' = answer and stop; 'balanced' = today's
  -- behaviour; 'detailed' = may expand. Kalibrasi asked for shorter, more
  -- natural replies; AIRE explicitly asked not to be touched, hence the default.
  ADD COLUMN IF NOT EXISTS reply_style VARCHAR(16) NOT NULL DEFAULT 'balanced',
  -- Hard ceiling the prompt states in lines. NULL = no explicit ceiling.
  ADD COLUMN IF NOT EXISTS reply_max_lines INTEGER,
  -- What the agent does with a question its knowledge base does not answer.
  -- 'open'   = today's behaviour: decline warmly, keep chatting, stay on brand.
  -- 'strict' = say plainly it is outside what it can answer and offer a human;
  --            never improvise around the gap.
  ADD COLUMN IF NOT EXISTS knowledge_scope VARCHAR(16) NOT NULL DEFAULT 'open',
  -- Free text appended to the prompt as the tenant's own extra house rules.
  -- This is the escape hatch for anything these flags do not cover, without a
  -- code change or a new column each time.
  ADD COLUMN IF NOT EXISTS style_instructions TEXT,
  -- When true, a request for a QUOTE (penawaran/RAB/proforma — not a simple
  -- "how much is X") hands the conversation to escalation_number immediately
  -- instead of the agent trying to price it.
  ADD COLUMN IF NOT EXISTS escalate_on_quote BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_reply_style_check;
ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_reply_style_check
  CHECK (reply_style IN ('concise', 'balanced', 'detailed'));

ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_knowledge_scope_check;
ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_knowledge_scope_check
  CHECK (knowledge_scope IN ('open', 'strict'));

-- A ceiling of 0 or a negative one would render as a prompt telling the agent
-- to say nothing; keep the column honest rather than defending in the renderer.
ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_reply_max_lines_check;
ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_reply_max_lines_check
  CHECK (reply_max_lines IS NULL OR (reply_max_lines >= 2 AND reply_max_lines <= 40));

COMMENT ON COLUMN agent_configs.reply_style IS
  'Tenant-owned verbosity of the customer agent. Defaults to the behaviour every tenant had before this column existed, so an untouched tenant reads identically.';
COMMENT ON COLUMN agent_configs.knowledge_scope IS
  'strict = refuse plainly outside the knowledge base and offer a human; open = decline warmly and steer back on topic (the prior behaviour).';
COMMENT ON COLUMN agent_configs.escalate_on_quote IS
  'True = a request for a written quote goes straight to escalation_number rather than being answered by the agent.';

COMMIT;
