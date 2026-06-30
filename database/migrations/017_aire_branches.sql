-- 017_aire_branches.sql
-- Adopt the real AIRE branch network from the previous system.
--   1. Add contact-detail columns (phone, Google Maps URL) to outlets.
--   2. Seed the live AIRE branches (Jabodetabek + Surabaya) for the demo tenant.
-- Idempotent: safe to re-run. Phone/maps are refreshed on conflict by agent_id.

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS phone    VARCHAR(30);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS maps_url TEXT;

INSERT INTO outlets (tenant_id, name, agent_id, code, phone, maps_url, timezone, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'AIRE Bintaro',       'aire-bintaro',      'BTR', '08118005650',  'https://maps.app.goo.gl/U4mXXbM56YqVpUc27', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE BSD',           'aire-bsd',          'BSD', '081930005858', 'https://maps.app.goo.gl/E6WvR1TAFSqqnbdW9', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Kencana Loka',  'aire-kencana-loka', 'KCL', '087895285858', 'https://maps.app.goo.gl/LPn2UmrmLX8JVaTc6', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Kota Wisata',   'aire-kota-wisata',  'KTW', '08118005929',  'https://maps.app.goo.gl/DiJTEwpTenXRromu8', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Kranggan',      'aire-kranggan',     'KRG', '081809005858', 'https://maps.app.goo.gl/34KY6qVYnkakpnTp7', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Jati Asih',     'aire-jati-asih',    'JTA', '081907005858', 'https://maps.app.goo.gl/BNjDgBrppABj2zYp7', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Citraland (SBY)', 'aire-citraland', 'CTL', '081805005858', 'https://maps.app.goo.gl/BwufmE9iNM7F2hBj7', 'Asia/Jakarta', true),
  ('11111111-1111-1111-1111-111111111111', 'AIRE Wiyung (SBY)',  'aire-wiyung',       'WYG', '08217646295',  'https://maps.app.goo.gl/TT1T43u7M7KCQk2L9', 'Asia/Jakarta', true)
ON CONFLICT (agent_id) DO UPDATE
  SET phone = EXCLUDED.phone,
      maps_url = EXCLUDED.maps_url,
      name = EXCLUDED.name,
      code = EXCLUDED.code;
