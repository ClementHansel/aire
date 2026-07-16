-- 069_camera_playback_meta.sql
-- Adds playback/NVR metadata to cameras so the cloud can (a) relay per-channel
-- live WITHOUT baking credentials into rtsp_url, and (b) build vendor playback
-- (archive) RTSP URLs for a requested time window.
--
-- playback_meta shape (JSONB):
--   {
--     "vendor":   "hikvision" | "dahua" | "onvif" | null,
--     "host":     "192.168.1.2",          -- the NVR (or camera) LAN IP
--     "port":     554,
--     "channel":  1,                       -- NVR channel number (1-based)
--     "stream":   "main" | "sub",
--     "cred_enc": "<iv:tag:ct>",           -- AES-GCM (SETTINGS_ENCRYPTION_KEY) NVR login, or null
--     "onvif":    true|false               -- channels came from ONVIF (vs vendor template)
--   }
-- Empty '{}' for a plain standalone camera whose rtsp_url already embeds everything.

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS playback_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
