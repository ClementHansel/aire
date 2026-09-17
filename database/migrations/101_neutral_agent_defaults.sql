-- Migration: 101_neutral_agent_defaults
-- Description: Stop handing every new tenant the founding tenant's bot identity
--              and the founding tenant's FACTS.
--
--   Migration 074 set column DEFAULTs on agent_configs so a new tenant had a
--   working assistant on day one. Those defaults are written in AIRE's voice and,
--   worse, contain AIRE's facts:
--
--     base_prompt        -> "asisten WhatsApp resmi untuk usaha cuci mobil &
--                            detailing (AIRE car wash, LEAD detailing)"
--     product_knowledge  -> "satu-satunya jenis membership adalah Unlimited
--                            Wash", "maksimal 3 plat nomor", "arahkan pelanggan
--                            ke outlet AIRE terdekat"
--
--   That was harmless while AIRE was the only tenant. It stops being harmless
--   the moment a second company is onboarded — especially one onboarding onto
--   the CHATBOT first: their customers would be told, confidently and in detail,
--   about another company's membership rules and told to visit AIRE's outlets.
--
--   So:
--     - base_prompt      -> a neutral default (tone, WhatsApp formatting,
--                           grounding, escalation). Identity is composed at
--                           runtime from the tenant's own persona + business
--                           name, so it does NOT belong in a stored default.
--     - product_knowledge-> NO default. Product knowledge is facts; there is no
--                           safe generic value. A tenant fills it in from the AI
--                           Knowledge page (typed, or by uploading documents).
--     - skills           -> UNCHANGED. It is a tool-routing playbook
--                           (get_branch_info / get_service_prices / …) that is
--                           already business-agnostic and genuinely useful.
--
--   EXISTING ROWS ARE NOT TOUCHED. Migration 074 backfilled every tenant that
--   existed then, so AIRE's wording lives in their own row and survives intact —
--   a column DEFAULT only ever applies to future INSERTs.

BEGIN;

ALTER TABLE agent_configs
  ALTER COLUMN base_prompt SET DEFAULT
    'Kamu adalah customer service (CS) untuk bisnis ini. Kamu ramah, hangat, dan asik diajak ngobrol. '
    'Di awal percakapan, buka dengan perkenalan yang hangat dan agak panjang: sapa pelanggan, perkenalkan dirimu dengan nama & peran, lalu tawarkan bantuan. Jangan membalas dengan satu kalimat singkat saja di awal. '
    'Balas pakai gaya chat WhatsApp yang santai, ramah, dan natural — boleh panggil pelanggan "kak", pakai emoji secukupnya, dan jangan kaku atau terlalu formal. '
    'Ini WhatsApp, bukan Markdown: untuk menebalkan pakai satu bintang *begini*, jangan pakai dua bintang, dan jangan pakai format link Markdown — tulis URL apa adanya. '
    'Tetap singkat dan jelas, dalam Bahasa Indonesia. Format uang sebagai Rp. '
    'Kamu bisa membantu: memberi lokasi & jam buka cabang, daftar harga layanan, info & paket membership, sisa voucher beserta kodenya, '
    'tanggal berakhir membership, serta membantu membuat janji/booking. '
    'PENTING: JANGAN pernah mengarang harga, promo, jam buka, layanan, atau data pelanggan — ambil semua informasi HANYA dari tools yang tersedia. '
    'Kalau kamu tidak yakin, tidak punya tool yang sesuai, pelanggan kesal, atau minta ngobrol sama orang/CS manusia, gunakan tool escalate_to_human.';

-- Facts have no safe default.
ALTER TABLE agent_configs
  ALTER COLUMN product_knowledge DROP DEFAULT;

COMMENT ON COLUMN agent_configs.base_prompt IS
  'Standing instructions for the tenant''s WhatsApp assistant. Tenant-editable '
  '(AI Knowledge page). Must NOT name a specific business — identity is composed '
  'at runtime from the tenant''s persona and business name.';
COMMENT ON COLUMN agent_configs.product_knowledge IS
  'Tenant-authored facts the assistant may state. No default: another tenant''s '
  'facts are worse than none.';

COMMIT;
