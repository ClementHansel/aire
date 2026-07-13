# Branch Bridge Protocol (IoT / CCTV on-prem agent)

The **Branch Bridge Agent** (`apps/branch-bridge`) runs on the tenant's LAN at a
branch (POS PC, Raspberry Pi, or mini-PC). It is the only thing that can see the
branch's cameras and IoT controllers — the cloud VPS cannot reach a private LAN.
The agent holds ONE **outbound** Socket.IO connection to the cloud backend, so no
inbound port-forwarding is ever required.

Cloud never scans or streams directly. It **dispatches** work to the bridge and
the bridge streams results/video back up the same socket.

```
Branch LAN                                   Cloud (backend :4000)
┌──────────────────────────┐  outbound WS   ┌───────────────────────────┐
│ branch-bridge agent       │◀──────────────▶│ BridgeGateway  ns=/bridge │
│  ONVIF / mDNS / SSDP scan │                │ DiscoveryService dispatch │
│  ffmpeg RTSP→HLS relay    │──segments─────▶│ CctvService live+history  │
│  local MQTT ⇄ bay sensors │                │ RealtimeGateway (bay evt) │
└──────────────────────────┘                └───────────────────────────┘
```

## Pairing & auth

- A Tenant_Owner creates a bridge for a branch in the UI. Backend inserts a
  `branch_bridges` row with a random opaque `pairing_token` (VARCHAR 64, unique)
  and returns it once, plus an install command.
- The agent is started with `AIRE_CLOUD_URL` + `AIRE_BRIDGE_TOKEN`.
- The agent connects: `io(`${cloudUrl}/bridge`, { auth: { token } })`.
- `BridgeGateway.handleConnection` looks up the token → resolves
  `{ bridgeId, tenantId, outletId }`. Invalid token → `client.disconnect(true)`.
- On connect the gateway marks the bridge `online` + updates `last_seen_at`, and
  tracks `bridgeId → socketId`. On disconnect → `offline`.
- All downstream data is scoped to the resolved tenant+outlet server-side; the
  agent can never widen scope (same guarantee as the n8n `bridge_token`).

## Socket events

### Cloud → Agent
| event | payload | agent action |
|-------|---------|--------------|
| `scan` | `{ scanId: string, protocols?: string[] }` | Run LAN scan; stream each device via `device`; finish with `scan:done`. |
| `configure` | `{ deviceId, device_type, connection_params }` | Camera → validate RTSP + start HLS relay. iot_controller → subscribe local MQTT topic. Reply `configure:result`. |
| `stream:start` | `{ cameraId, rtspUrl }` | Start ffmpeg RTSP→HLS; emit `hls:playlist` + `hls:segment`. |
| `stream:stop` | `{ cameraId }` | Kill ffmpeg for that camera. |
| `command` | `{ bayId, action }` action ∈ gate_open\|gate_close\|start_wash\|stop_wash\|emergency_stop | Publish to local MQTT command topic. |

### Agent → Cloud
| event | payload | cloud action |
|-------|---------|--------------|
| `device` | `{ scanId, device: DiscoveredDeviceInput }` | Upsert into scan buffer for the scanId. |
| `scan:done` | `{ scanId, count, errors: {protocol,message}[] }` | Resolve the pending scan; persist devices to tenant settings scoped to this bridge's outlet. |
| `configure:result` | `{ deviceId, ok: boolean, error?: string, connection_params?: object }` | Resolve pending confirm; persist connection_params. |
| `hls:playlist` | `{ cameraId, m3u8: string }` | Store latest live playlist for camera. |
| `hls:segment` | `{ cameraId, name: string, dataB64: string, durationSec: number, seq: number }` | Push into per-camera ring buffer; if recording, also persist to MinIO. |
| `sensor` | `{ bayId, vehiclePresent, waterFlow, foamLevel, machineStatus, timestamp }` | Update `bays.sensor_data` + `RealtimeGateway.emitBayStatusChanged`. |
| `heartbeat` | `{ ts, cameras: string[], devices: string[] }` | Update `last_seen_at`, online device set. |

`DiscoveredDeviceInput` = `{ ip_address, device_type: 'camera'|'iot_controller'|'router', manufacturer: string|null, model: string|null, connection_params?: object }`.
The cloud assigns `device_id` (uuid), `suggested_label`, `status`, timestamps.

## Live CCTV serving (browser)

HLS is pull-based, so "live" needs no browser socket:
- Agent relays segments up; backend keeps the last N (~6) segments per camera in
  memory + the rolling `live.m3u8`.
- Backend serves (JWT-guarded, tenant-scoped):
  - `GET /api/cctv/cameras/:id/live.m3u8` → current live playlist
  - `GET /api/cctv/cameras/:id/seg/:name` → a segment (mpegts)
- Frontend plays with hls.js (`<video>`), Safari uses native HLS.

## Recording history

- `POST /api/cctv/cameras/:id/record { orderId? }` → create `camera_recordings`
  row (status=recording); backend starts persisting that camera's incoming
  segments to MinIO under `recordings/{cameraId}/{recordingId}/`.
- `DELETE /api/cctv/recordings/:id` → stop; write a VOD `index.m3u8` listing the
  stored segments; set status=completed, duration, storage_path.
- `GET /api/cctv/recordings?outletId=&cameraId=` → history list.
- `GET /api/cctv/recordings/:id/index.m3u8` + `/seg/:name` → VOD playback (hls.js).

## Scan wizard flow (frontend)

1. **Branch & bridge** — pick outlet; show its bridge status (online/offline). If
   no bridge, offer "Add bridge" (token + install command). Block scan if offline.
2. **Scanning** — `POST /api/discovery/:tenantId/scan { outletId }` returns
   `{ scanId }`; poll `GET /api/discovery/:tenantId/scan/:scanId` for
   `{ status, devices }` until `done`; show devices as they arrive.
3. **Review** — list found devices (type, ip, label).
4. **Configure** — per device: assign outlet (default = scanned outlet) + bay
   (cameras optional); `POST .../devices/:deviceId/confirm` triggers bridge
   auto-config; show ✓/✗ per device.
5. **Done** — summary; cameras link to the live CCTV page.

## Conventions

- Standalone agent app mirrors `apps/iot-gateway` packaging (own package.json +
  package-lock, outside the pnpm workspace, own Dockerfile, tsc build).
- Keep DTOs local to modules / duplicated in `frontend/src/lib`; do NOT modify
  `@aire/shared` (avoids the shared-dist rebuild gotcha).
- MQTT topics reuse the existing scheme:
  `aire/{tenantId}/{outletId}/bay/{bayId}/{sensor|command}`.
