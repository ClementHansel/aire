-- 026_platform_pricing.sql
-- Seed default platform pricing tiers so the admin MRR estimate is non-zero out
-- of the box. Editable later via Platform Config. Only fills tiers if empty.

UPDATE platform_config
SET config = jsonb_set(
      config,
      '{pricingTiers}',
      '[{"plan":"standard","price":499000},{"plan":"premium","price":1499000},{"plan":"enterprise","price":4999000}]'::jsonb
    ),
    updated_at = NOW()
WHERE id = 'default'
  AND (config->'pricingTiers' IS NULL OR jsonb_array_length(config->'pricingTiers') = 0);
