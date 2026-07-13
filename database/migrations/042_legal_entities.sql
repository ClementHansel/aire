-- Migration: 042_legal_entities
-- Description: Promote the branch free-text "legal entity (PT)" into tenant-owned
--   records. A tenant has many legal entities (PT); each branch (outlet) is
--   assigned to exactly one of them via outlets.legal_entity_id.
-- Created at: 2026-07-12

BEGIN;

-- ── Legal entities (PT) — owned by the tenant, reused across its branches ─────────
CREATE TABLE IF NOT EXISTS legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  /** NPWP — Indonesian tax id, used on invoices/receipts */
  npwp VARCHAR(30),
  address TEXT,
  phone VARCHAR(30),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_legal_entities_tenant ON legal_entities(tenant_id, is_active);

-- ── Branch → legal entity assignment (null = unassigned) ──────────────────────────
-- Keeps the legacy free-text outlets.legal_entity column for back-compat; the FK is
-- the source of truth going forward.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outlets_legal_entity ON outlets(legal_entity_id);

-- Backfill: promote each distinct free-text legal_entity per tenant into a record …
INSERT INTO legal_entities (tenant_id, name)
SELECT DISTINCT tenant_id, TRIM(legal_entity)
  FROM outlets
 WHERE legal_entity IS NOT NULL AND TRIM(legal_entity) <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

-- … and link every outlet to its matching record.
UPDATE outlets o
   SET legal_entity_id = le.id
  FROM legal_entities le
 WHERE le.tenant_id = o.tenant_id
   AND le.name = TRIM(o.legal_entity)
   AND o.legal_entity IS NOT NULL AND TRIM(o.legal_entity) <> ''
   AND o.legal_entity_id IS NULL;

COMMIT;
