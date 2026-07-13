-- Migration: 047_accounting_ledger
-- Description: A real double-entry bookkeeping ledger. Until now all financials
--   were derived on-the-fly by SUM-ing operational tables (orders, expenses,
--   payslips) with no persisted balances. This adds a proper general ledger:
--     * chart_of_accounts — per-tenant accounts (asset/liability/equity/revenue/expense)
--     * journal_entries    — one balanced transaction (debits = credits), optionally
--                            tied to a source operational row for idempotent auto-posting
--     * journal_lines      — the debit/credit lines of an entry
--   Entries are auto-posted from money events (sales, COGS, expenses, payroll) by
--   the accounting module, and can also be created manually. The
--   (tenant_id, source_type, source_id) unique index makes auto-posting idempotent
--   so the same order/expense/payroll run is never booked twice (and a backfill
--   "sync" can safely re-run). Balances, trial balance and the GL are computed by
--   aggregating journal_lines.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code           VARCHAR(20) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  type           VARCHAR(12) NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_system      BOOLEAN NOT NULL DEFAULT false,   -- seeded defaults referenced by auto-posting; not deletable
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coa_tenant ON chart_of_accounts (tenant_id, type);

CREATE TABLE IF NOT EXISTS journal_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id    UUID REFERENCES outlets(id) ON DELETE SET NULL,
  entry_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  memo         TEXT,
  source_type  VARCHAR(30) NOT NULL DEFAULT 'manual',  -- order | expense | payroll | manual | settlement
  source_id    UUID,                                   -- operational row id (NULL for manual)
  status       VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Idempotency for auto-posting: one entry per source row. NULL source_id (manual
-- entries) are treated as distinct by Postgres, so manual entries are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_source ON journal_entries (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_tenant_date ON journal_entries (tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_outlet ON journal_entries (outlet_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit      DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit     DECIMAL(14,2) NOT NULL DEFAULT 0,
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit >= 0 AND credit >= 0)
);
CREATE INDEX IF NOT EXISTS idx_jline_entry ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_jline_account ON journal_lines (tenant_id, account_id);

COMMIT;
