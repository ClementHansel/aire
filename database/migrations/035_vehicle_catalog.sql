-- Migration: 035_vehicle_catalog
-- Description: Vehicle brand + type catalog so POS/queue can pick brand → type
--   from dropdowns instead of free text (orders still store the chosen names in
--   vehicle_brand/vehicle_model — no order schema change). Seeds a common
--   Indonesian brand/type list for existing tenants; admins manage the rest.
-- Created at: 2026-07-10

BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS vehicle_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_brands_tenant ON vehicle_brands(tenant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_vehicle_types_brand ON vehicle_types(brand_id, is_active, sort_order);

-- Seed common Indonesian brands for every existing tenant.
INSERT INTO vehicle_brands (tenant_id, name, sort_order)
SELECT t.id, b.name, b.ord
FROM tenants t
CROSS JOIN (VALUES
  ('Toyota',1),('Honda',2),('Daihatsu',3),('Suzuki',4),('Mitsubishi',5),
  ('Nissan',6),('Hyundai',7),('Wuling',8),('Mazda',9),('Kia',10)
) AS b(name, ord)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Seed common types for the popular brands.
INSERT INTO vehicle_types (tenant_id, brand_id, name, sort_order)
SELECT vb.tenant_id, vb.id, ty.name, ty.ord
FROM vehicle_brands vb
JOIN (VALUES
  ('Toyota','Avanza',1),('Toyota','Innova',2),('Toyota','Rush',3),('Toyota','Agya',4),('Toyota','Fortuner',5),('Toyota','Calya',6),
  ('Honda','Brio',1),('Honda','Jazz',2),('Honda','Mobilio',3),('Honda','HR-V',4),('Honda','CR-V',5),('Honda','BR-V',6),
  ('Daihatsu','Xenia',1),('Daihatsu','Terios',2),('Daihatsu','Ayla',3),('Daihatsu','Sigra',4),
  ('Suzuki','Ertiga',1),('Suzuki','XL7',2),('Suzuki','Carry',3),
  ('Mitsubishi','Xpander',1),('Mitsubishi','Pajero Sport',2)
) AS ty(brand, name, ord) ON ty.brand = vb.name
ON CONFLICT (brand_id, name) DO NOTHING;

COMMIT;
