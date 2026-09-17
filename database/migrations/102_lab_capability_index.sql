-- Migration: 102_lab_capability_index
-- Description: A queryable index of what each laboratory is ACCREDITED to calibrate,
--              so the assistant can answer "can you do X at Y" from data instead of
--              from a prompt it was handed.
--
--   The second tenant is a calibration marketplace: it runs its own accredited lab
--   (LK-240-IDN) and routes work it cannot do in-house to partner laboratories.
--   Their combined KAN scopes are ~44 PDFs across 27 labs — roughly 400k characters,
--   or ~220k tokens at the ~1.79 chars/token this dense tabular Indonesian actually
--   costs. The knowledge-document prompt budget is 40k CHARACTERS. It does not fit,
--   and it never will: a capability index grows with the business.
--
--   So this is deliberately NOT another knowledge document. It is a table the agent
--   queries through a tool, returning the handful of rows that answer the question
--   (~200 tokens) instead of the model recalling one row out of five thousand it was
--   shown. That also fixes the failure mode that makes the prompt approach dangerous
--   here: a model cannot tell "not accredited" from "truncated out of my context",
--   and both come back as a confident no.
--
--   Ranges are the whole point. Two labs both "calibrate Timbangan"; one stops at
--   1000 kg and the other reaches 4000 kg. Matching on instrument name alone gives a
--   confidently wrong answer on exactly the axis the routing decision turns on —
--   hence the SI columns below, which exist so 20 kV and 1000 V are comparable.

BEGIN;

-- ── Laboratories ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_partners (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  -- KAN accreditation number, e.g. 'LK-240-IDN'. The natural key for a lab here.
  lk_number         VARCHAR(32) NOT NULL,
  -- The tenant's OWN laboratory, as opposed to a partner it routes work to. Drives
  -- "in-house first" ordering when several labs can do the same job.
  is_own_lab        BOOLEAN NOT NULL DEFAULT FALSE,
  accredited_until  DATE,
  address           TEXT,
  phone             VARCHAR(40),
  email             VARCHAR(255),
  -- Which PDF these rows were transcribed from, so a disputed figure is traceable
  -- back to a specific amendment rather than "the certificate".
  source_document   TEXT,
  -- Set false to take a lab out of routing without deleting its scope (expired
  -- accreditation, commercial dispute) — the rows stay for audit.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_partners_tenant_lk_key UNIQUE (tenant_id, lk_number)
);

CREATE INDEX IF NOT EXISTS idx_lab_partners_tenant ON lab_partners(tenant_id, is_active, is_own_lab);

-- ── Capabilities (CMC rows) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_capabilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id          UUID NOT NULL REFERENCES lab_partners(id) ON DELETE CASCADE,

  -- 'Suhu dan Kelembapan', 'Kelistrikan', 'Massa', ... as the certificate groups them.
  measurement_group   TEXT NOT NULL,
  -- As printed on the certificate, e.g. 'Sensor Termokopel Tipe K'. Shown to humans.
  instrument          TEXT NOT NULL,
  -- Lowercased, punctuation-stripped form used for matching a customer's wording.
  -- Denormalised deliberately: the match runs on every scope question.
  instrument_search   TEXT NOT NULL,

  -- Range AS PRINTED, kept verbatim so a quote can cite the certificate's own words.
  range_text          TEXT,
  unit                VARCHAR(24),

  -- Range in a CANONICAL unit per quantity, which is what makes comparison work:
  -- a certificate lists mV, V and kV for the same quantity, and '2 A' must lose to
  -- a lab whose scope reaches '1000 A'. NULL for single-point entries (e.g. a 1 kg
  -- weight), where range_point_si carries the value instead.
  quantity            VARCHAR(32),
  canonical_unit      VARCHAR(16),
  range_min_si        NUMERIC,
  range_max_si        NUMERIC,
  range_point_si      NUMERIC,

  -- Expanded uncertainty exactly as printed ('0.064 C', '0.20 % of reading').
  -- TEXT, not numeric: a meaningful share are percentages of reading, and silently
  -- coercing those to a number would invent precision the certificate does not claim.
  uncertainty         TEXT,
  method              TEXT,
  notes               TEXT,

  -- FALSE until a human has checked this row against the source PDF. Extraction
  -- quality varies badly between certificates — one drops the degree symbol, so
  -- '30 °C ~ 70 °C' arrives as '30 0C ~ 70 0C'. Unverified rows must never be used
  -- to tell a customer yes.
  verified            BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_capabilities_search
  ON lab_capabilities(tenant_id, instrument_search);
CREATE INDEX IF NOT EXISTS idx_lab_capabilities_partner
  ON lab_capabilities(partner_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lab_capabilities_quantity
  ON lab_capabilities(tenant_id, quantity, range_min_si, range_max_si);

COMMENT ON TABLE lab_partners IS
  'Laboratories whose KAN accreditation scope this tenant can route work to, '
  'including the tenant''s own lab (is_own_lab).';
COMMENT ON TABLE lab_capabilities IS
  'One row per accredited instrument+range (CMC). Queried by the assistant through '
  'a tool; never loaded into a prompt. See migration 102 for why.';
COMMENT ON COLUMN lab_capabilities.verified IS
  'Human-checked against the source PDF. Unverified rows must not answer a customer.';

DROP TRIGGER IF EXISTS set_updated_at_lab_partners ON lab_partners;
CREATE TRIGGER set_updated_at_lab_partners BEFORE UPDATE ON lab_partners
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lab_capabilities ON lab_capabilities;
CREATE TRIGGER set_updated_at_lab_capabilities BEFORE UPDATE ON lab_capabilities
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
