-- 020_membership_free_services.sql
-- Make the seeded "Unlimited Wash" membership plans actually grant their daily
-- free wash by populating free_service_ids (previously NULL → membership gave
-- no benefit at the POS). Also add the real 6-month Jabodetabek tier from the
-- client's published price list (Rp 1,500,000; free Standard + Complete + Premium).
--   • 1 & 3 month plans → free Standard wash (per region).
--   • 6 month plan (premium tier) → free Standard + Complete + Premium.
-- Idempotent: UPDATEs are repeatable; the 6-month INSERT is guarded.

DO $$
DECLARE
  t_id      UUID := '11111111-1111-1111-1111-111111111111';
  btr       UUID;
  ctl       UUID;
  jabo      UUID[];
  std_jabo  UUID;
  comp_jabo UUID;
  prem_jabo UUID;
  std_sby   UUID;
BEGIN
  SELECT id INTO btr FROM outlets WHERE tenant_id = t_id AND agent_id = 'aire-bintaro';
  SELECT id INTO ctl FROM outlets WHERE tenant_id = t_id AND agent_id = 'aire-citraland';
  jabo := ARRAY(SELECT id FROM outlets WHERE tenant_id = t_id AND agent_id IN
    ('aire-bintaro','aire-bsd','aire-kencana-loka','aire-kota-wisata','aire-kranggan','aire-jati-asih'));

  -- Resolve the region-specific car-wash service ids.
  SELECT id INTO std_jabo  FROM services WHERE tenant_id = t_id AND business_unit = 'AIRE' AND name = 'Standard' AND btr = ANY(outlet_ids) LIMIT 1;
  SELECT id INTO comp_jabo FROM services WHERE tenant_id = t_id AND business_unit = 'AIRE' AND name = 'Complete' AND btr = ANY(outlet_ids) LIMIT 1;
  SELECT id INTO prem_jabo FROM services WHERE tenant_id = t_id AND business_unit = 'AIRE' AND name = 'Premium'  AND btr = ANY(outlet_ids) LIMIT 1;
  SELECT id INTO std_sby   FROM services WHERE tenant_id = t_id AND business_unit = 'AIRE' AND name = 'Standard' AND ctl = ANY(outlet_ids) LIMIT 1;

  -- 1 & 3 month → free daily Standard wash (per region).
  IF std_jabo IS NOT NULL THEN
    UPDATE membership_plans SET free_service_ids = ARRAY[std_jabo], updated_at = NOW()
     WHERE tenant_id = t_id AND name IN ('Unlimited Wash - 1 Month (Jabodetabek)', 'Unlimited Wash - 3 Month (Jabodetabek)');
  END IF;
  IF std_sby IS NOT NULL THEN
    UPDATE membership_plans SET free_service_ids = ARRAY[std_sby], updated_at = NOW()
     WHERE tenant_id = t_id AND name IN ('Unlimited Wash - 1 Month (Surabaya)', 'Unlimited Wash - 3 Month (Surabaya)');
  END IF;

  -- 6 month Jabodetabek premium tier (free Standard + Complete + Premium).
  IF NOT EXISTS (SELECT 1 FROM membership_plans WHERE tenant_id = t_id AND name = 'Unlimited Wash - 6 Month (Jabodetabek)') THEN
    INSERT INTO membership_plans
      (tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price, outlet_ids, free_service_ids)
    VALUES
      (t_id, 'Unlimited Wash - 6 Month (Jabodetabek)', 6, 186, 1, 3, 1500000, jabo,
       ARRAY(SELECT x FROM unnest(ARRAY[std_jabo, comp_jabo, prem_jabo]) AS x WHERE x IS NOT NULL));
  END IF;
END $$;
