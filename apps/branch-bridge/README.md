# @aire/branch-bridge

On-prem **Branch Bridge Agent** for the AIRE car-wash SaaS. It runs on the
tenant's LAN at a branch (POS PC, Raspberry Pi, or mini-PC) and is the only
component that can see local cameras and IoT bay controllers. The cloud VPS
cannot reach a private LAN, so the agent holds **one outbound Socket.IO
connection** to the cloud and streams results/video back up that socket — no
inbound port-forwarding is ever required.

See `docs/tech/07-branch-bridge-protocol.md` for the full contract.

## What it does

- **Discovery** — scans the LAN for cameras / IoT controllers / routers using
  ONVIF WS-Discovery, mDNS (bonjour), SSDP, and a bounded TCP port probe.
- **CCTV relay** — spawns `ffmpeg` to convert a camera's RTSP feed into HLS and
  streams the playlist + base64 segments up to the cloud.
- **IoT bridge** — subscribes to the local MQTT broker for bay sensor readings
  and publishes bay commands (gate/wash/emergency-stop) received from the cloud.

## Requirements

- Node.js 20+
- `ffmpeg` available on `PATH` (or set `FFMPEG_PATH`). Installed automatically in
  the Docker image.
- A local MQTT broker (Mosquitto) for real IoT — not required in simulate mode.

## Configuration (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `AIRE_CLOUD_URL` | `http://localhost:4000` | Cloud backend base URL. |
| `AIRE_BRIDGE_TOKEN` | — (required) | Opaque pairing token issued by the cloud. |
| `AIRE_SIMULATE` | `false` | Hardware-free demo: synthetic devices/stream/sensors. |
| `AIRE_MQTT_URL` | `mqtt://localhost:1883` | Local MQTT broker. |
| `SCAN_SUBNET` | auto (`/24` of local IPv4) | Explicit subnet for the TCP probe. |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary. |
| `HLS_TMP_DIR` | `<os tmp>/aire-hls` | Scratch dir for HLS output. |
| `BRIDGE_HEALTH_PORT` | `4010` | Local `/health` HTTP port. |
| `AIRE_TENANT_ID` / `AIRE_OUTLET_ID` | learned from sensor topics | Scope for MQTT command topics. |

## Run

### Hardware-free demo (simulate)

No camera, no broker, no token needed — great for a laptop demo. A synthetic
camera streams an ffmpeg test pattern and a fake bay sensor emits every ~10s:

```bash
AIRE_SIMULATE=true AIRE_CLOUD_URL=http://localhost:4000 npm run dev
```

or with the built output:

```bash
npm run build
AIRE_SIMULATE=true node dist/index.js
```

Health check: `curl http://localhost:4010/health`.

### Production (real hardware)

```bash
docker build -t aire-branch-bridge apps/branch-bridge
docker run -d --name aire-bridge --network host \
  -e AIRE_CLOUD_URL=https://app.example.com \
  -e AIRE_BRIDGE_TOKEN=<token-from-ui> \
  -e AIRE_MQTT_URL=mqtt://localhost:1883 \
  aire-branch-bridge
```

`--network host` lets ONVIF/mDNS/SSDP discovery and the local MQTT broker work
against the real LAN.

## Scripts

- `npm run build` — compile TypeScript to `dist/`.
- `npm run dev` — run with `tsx` (watch).
- `npm start` — run compiled `dist/index.js`.
- `npm test` — run vitest unit tests.
