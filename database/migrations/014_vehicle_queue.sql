-- Migration: 014_vehicle_queue
-- Description: Resto-style POS arrival queue. The cashier records each car as it
--   arrives (plate, brand, type) in arrival order; product + payment are completed
--   later. Decoupled from orders (an order is created at completion).
-- Created at: 2026-06-30

BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  plate VARCHAR(20),
  brand VARCHAR(100),
  model VARCHAR(100),
  customer_name VARCHAR(255),
  customer_phone VARCHAR(20),
  business_unit VARCHAR(10) CHECK (business_unit IS NULL OR business_unit IN ('AIRE','LEAD')),
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','serving','done','cancelled')),
  position INTEGER NOT NULL DEFAULT 0,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_queue_outlet ON vehicle_queue(outlet_id, status, position);

COMMIT;
