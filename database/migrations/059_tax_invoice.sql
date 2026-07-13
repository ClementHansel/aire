-- Migration: 059_tax_invoice
-- Description: Indonesian tax invoice (Faktur Pajak) + e-Faktur / Coretax export.
--   The app tracked PPN internally in the ledger but produced no Faktur Pajak
--   document and no Coretax bulk-import file. This adds:
--     * customers tax fields (npwp, nik, tax_name, tax_address) — buyer identity.
--     * tax_invoices — one issued Faktur Pajak per order/invoice: faktur number,
--       buyer identity, DPP (tax base = total - PPN), PPN, transaction code, status.
--   The export builder produces the Coretax import file (+ CSV) from a date range;
--   the printable Faktur Pajak reuses the doc-template renderer. Seller NPWP and the
--   enable toggle live in tenants.settings.taxInvoice (default OFF).
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS npwp        VARCHAR(32),
  ADD COLUMN IF NOT EXISTS nik         VARCHAR(32),
  ADD COLUMN IF NOT EXISTS tax_name    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tax_address TEXT;

CREATE TABLE IF NOT EXISTS tax_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id       UUID REFERENCES outlets(id) ON DELETE SET NULL,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id      UUID,                              -- optional link to invoices table
  faktur_number   VARCHAR(40) NOT NULL,
  kode_transaksi  VARCHAR(4) NOT NULL DEFAULT '04',  -- Coretax transaction code
  buyer_npwp      VARCHAR(32),
  buyer_nik       VARCHAR(32),
  buyer_name      VARCHAR(255),
  buyer_address   TEXT,
  dpp             DECIMAL(14,2) NOT NULL,            -- tax base (total - PPN)
  ppn             DECIMAL(14,2) NOT NULL,            -- PPN amount
  status          VARCHAR(10) NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('draft','issued','exported','void')),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at     TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_tenant ON tax_invoices(tenant_id, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoice_number ON tax_invoices(tenant_id, faktur_number);
-- One issued tax invoice per order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoice_order ON tax_invoices(order_id)
  WHERE order_id IS NOT NULL;

COMMIT;
