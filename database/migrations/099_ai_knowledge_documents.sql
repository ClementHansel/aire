-- Migration: 099_ai_knowledge_documents
-- Description: Uploadable knowledge-base documents for the customer AI (Irene).
--
--   Until now a tenant's entire "business knowledge" was ONE free-text box
--   (agent_configs.product_knowledge). Anything the owner wanted the assistant
--   to know — a price list, a terms sheet, the cashier handbook — had to be
--   retyped into that box by hand, and there was no way to keep several topics
--   apart, to turn one topic off for a while, or to see where a fact came from.
--
--   This table holds the uploaded documents as EXTRACTED TEXT, not as files.
--   The prompt only ever needs the text, extraction happens once at upload time
--   (see knowledge-extract.ts), and keeping the text in the row is what makes
--   "modify existing" possible: the owner edits what the AI actually reads,
--   instead of having to re-export a PDF. The original file is not stored —
--   `file_name`/`mime_type`/`size_bytes` are kept purely so the UI can show
--   where a document came from.
--
--   `enabled` is the per-document switch: off means the text stays here for
--   later but is left out of the prompt (same idea as notification_templates
--   rows that exist only to record `enabled = false`).
-- Created at: 2026-09-16

BEGIN;

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  -- Extracted, plain-text body. This is verbatim what gets appended to the
  -- system prompt, so it is also what the owner edits in the dashboard.
  content     TEXT NOT NULL DEFAULT '',
  -- Provenance of the text: 'upload' (a parsed file) or 'manual' (typed note).
  source      VARCHAR(16) NOT NULL DEFAULT 'manual',
  file_name   TEXT,
  mime_type   TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  -- Owner-controlled order; the prompt concatenates documents in this order so
  -- the most important sheet can be put first.
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read is "this tenant's documents, in display order"; the WhatsApp path
-- adds `enabled` on top of that and runs on every inbound message.
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_tenant
  ON ai_knowledge_documents (tenant_id, sort_order, created_at);

ALTER TABLE ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ai_knowledge_documents ON ai_knowledge_documents;
CREATE POLICY tenant_isolation_ai_knowledge_documents ON ai_knowledge_documents
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Keep updated_at honest via the shared trigger installed in 004.
DROP TRIGGER IF EXISTS set_updated_at_ai_knowledge_documents ON ai_knowledge_documents;
CREATE TRIGGER set_updated_at_ai_knowledge_documents
  BEFORE UPDATE ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE ai_knowledge_documents IS
  'Tenant knowledge-base documents (extracted text) appended to the customer AI system prompt.';
COMMENT ON COLUMN ai_knowledge_documents.content IS
  'Extracted plain text — exactly what is injected into the prompt, and what the owner edits.';
COMMENT ON COLUMN ai_knowledge_documents.enabled IS
  'False keeps the document but leaves it out of the prompt.';

COMMIT;
