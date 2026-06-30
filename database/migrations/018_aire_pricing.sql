-- 018_aire_pricing.sql
-- Seed the real AIRE (car wash) + LEAD (detailing) service catalog and membership
-- plans from the previous system's published price lists.
--   • AIRE car wash prices differ by region → scoped via outlet_ids
--     (Jabodetabek branches vs Surabaya branches). The POS passes the cashier's
--     outletId so each branch only sees its own prices.
--   • LEAD detailing prices are size-based (S-M / L-XL) → modelled as two rows each,
--     available to all branches. LEAD list prices are in thousands of rupiah and are
--     stored here as full rupiah (e.g. 7800 → 7,800,000).
--   • Vouchers (e.g. "10x Wash") are created ad-hoc at point of sale (voucher_books),
--     so there is no voucher product to seed; reference prices: Jabodetabek 399,000 /
--     Surabaya 549,000 for a 10x book valid 3 months.
-- Idempotent: the whole seed is skipped if it has already run.

DO $$
DECLARE
  t_id UUID := '11111111-1111-1111-1111-111111111111';
  jabo UUID[];
  sby  UUID[];
BEGIN
  IF EXISTS (SELECT 1 FROM services WHERE tenant_id = t_id AND name = 'Premium' AND business_unit = 'AIRE') THEN
    RAISE NOTICE 'AIRE pricing already seeded; skipping.';
    RETURN;
  END IF;

  jabo := ARRAY(SELECT id FROM outlets WHERE tenant_id = t_id AND agent_id IN
    ('aire-bintaro','aire-bsd','aire-kencana-loka','aire-kota-wisata','aire-kranggan','aire-jati-asih'));
  sby := ARRAY(SELECT id FROM outlets WHERE tenant_id = t_id AND agent_id IN
    ('aire-citraland','aire-wiyung'));

  -- ── AIRE car wash — Jabodetabek ─────────────────────────────────────────────
  INSERT INTO services (tenant_id, name, category, business_unit, price, is_main_service, sort_order, outlet_ids) VALUES
    (t_id, 'Standard', 'car_wash', 'AIRE', 60000,  true, 1, jabo),
    (t_id, 'Complete', 'car_wash', 'AIRE', 110000, true, 2, jabo),
    (t_id, 'Premium',  'car_wash', 'AIRE', 150000, true, 3, jabo);

  -- ── AIRE car wash — Surabaya ────────────────────────────────────────────────
  INSERT INTO services (tenant_id, name, category, business_unit, price, is_main_service, sort_order, outlet_ids) VALUES
    (t_id, 'Exterior', 'car_wash', 'AIRE', 60000,  true, 1, sby),
    (t_id, 'Standard', 'car_wash', 'AIRE', 85000,  true, 2, sby),
    (t_id, 'Complete', 'car_wash', 'AIRE', 135000, true, 3, sby),
    (t_id, 'Premium',  'car_wash', 'AIRE', 175000, true, 4, sby);

  -- ── AIRE add-ons (member pricing, all branches) ─────────────────────────────
  INSERT INTO services (tenant_id, name, category, business_unit, price, is_main_service, sort_order) VALUES
    (t_id, '+ Spray Wax',       'add_on', 'AIRE', 30000, false, 10),
    (t_id, '+ Polymer Coating', 'add_on', 'AIRE', 60000, false, 11);

  -- ── LEAD detailing — main coating packages (size variants) ──────────────────
  INSERT INTO services (tenant_id, name, category, business_unit, price, is_main_service, sort_order) VALUES
    (t_id, 'Stellar Coating (S-M)',      'car_wash', 'LEAD', 7800000, true, 1),
    (t_id, 'Stellar Coating (L-XL)',     'car_wash', 'LEAD', 9200000, true, 2),
    (t_id, 'Prime Coating (S-M)',        'car_wash', 'LEAD', 6000000, true, 3),
    (t_id, 'Prime Coating (L-XL)',       'car_wash', 'LEAD', 7200000, true, 4),
    (t_id, 'Pro Coating (S-M)',          'car_wash', 'LEAD', 4800000, true, 5),
    (t_id, 'Pro Coating (L-XL)',         'car_wash', 'LEAD', 5800000, true, 6),
    (t_id, 'Clean.Shine.Protect (S-M)',  'car_wash', 'LEAD', 900000,  true, 7),
    (t_id, 'Clean.Shine.Protect (L-XL)', 'car_wash', 'LEAD', 1200000, true, 8);

  -- ── LEAD detailing — additional services (size variants) ────────────────────
  INSERT INTO services (tenant_id, name, category, business_unit, price, is_main_service, sort_order) VALUES
    (t_id, 'Engine Detailing (S-M)',                  'add_on', 'LEAD', 650000,  false, 20),
    (t_id, 'Engine Detailing (L-XL)',                 'add_on', 'LEAD', 800000,  false, 21),
    (t_id, 'Deep Clean / Interior Detailing (S-M)',   'add_on', 'LEAD', 800000,  false, 22),
    (t_id, 'Deep Clean / Interior Detailing (L-XL)',  'add_on', 'LEAD', 1000000, false, 23),
    (t_id, 'MSPC / Exterior Detailing (S-M)',         'add_on', 'LEAD', 1800000, false, 24),
    (t_id, 'MSPC / Exterior Detailing (L-XL)',        'add_on', 'LEAD', 2200000, false, 25),
    (t_id, 'Complete Detailing (S-M)',                'add_on', 'LEAD', 2400000, false, 26),
    (t_id, 'Complete Detailing (L-XL)',               'add_on', 'LEAD', 3000000, false, 27),
    (t_id, 'AC Cleaner by SONAX (S-M)',               'add_on', 'LEAD', 1800000, false, 28),
    (t_id, 'AC Cleaner by SONAX (L-XL)',              'add_on', 'LEAD', 1800000, false, 29),
    (t_id, 'Window Cleaning (S-M)',                   'add_on', 'LEAD', 500000,  false, 30),
    (t_id, 'Window Cleaning (L-XL)',                  'add_on', 'LEAD', 600000,  false, 31),
    (t_id, 'Window Coating (S-M)',                    'add_on', 'LEAD', 1000000, false, 32),
    (t_id, 'Window Coating (L-XL)',                   'add_on', 'LEAD', 1200000, false, 33),
    (t_id, 'Windshield Coating (S-M)',                'add_on', 'LEAD', 200000,  false, 34),
    (t_id, 'Windshield Coating (L-XL)',               'add_on', 'LEAD', 300000,  false, 35),
    (t_id, 'Seat Cleaning (incl. removal)',           'add_on', 'LEAD', 1200000, false, 36);

  -- ── Membership plans (1x standard wash/day, up to 3 plates) ─────────────────
  INSERT INTO membership_plans (tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price, outlet_ids) VALUES
    (t_id, 'Unlimited Wash - 1 Month (Jabodetabek)', 1, 31, 1, 3, 349000,  jabo),
    (t_id, 'Unlimited Wash - 3 Month (Jabodetabek)', 3, 93, 1, 3, 949000,  jabo),
    (t_id, 'Unlimited Wash - 1 Month (Surabaya)',    1, 31, 1, 3, 499000,  sby),
    (t_id, 'Unlimited Wash - 3 Month (Surabaya)',    3, 93, 1, 3, 1349000, sby);

  RAISE NOTICE 'AIRE/LEAD pricing seeded.';
END $$;
