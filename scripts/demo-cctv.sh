#!/usr/bin/env bash
# =============================================================================
# AIRE — Local CCTV demo (webcam as a branch camera)
#
# Turns THIS laptop's webcam into a live branch-bridge camera you can watch in
# the dashboard, using the seeded demo account. Meant for sales/support demos:
#   - `demo-cctv.sh up`      wire the webcam through end-to-end (default)
#   - `demo-cctv.sh status`  show what's running + the dashboard link
#   - `demo-cctv.sh down`    stop the webcam feed + demo RTSP server
#
# Requirements on the machine running this:
#   - Docker Desktop with the AIRE stack already up (`docker compose up -d`)
#   - ffmpeg on PATH (Windows: winget install Gyan.FFmpeg | mac: brew install ffmpeg)
#   - A webcam
#
# Everything is idempotent — safe to re-run. Override any DEMO_* / *_PORT via env.
# =============================================================================
set -uo pipefail

# --- locate repo root + load ports from .env -------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
envget() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r'; }

BACKEND_PORT="${BACKEND_PORT:-$(envget BACKEND_PORT)}"; BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-$(envget FRONTEND_PORT)}"; FRONTEND_PORT="${FRONTEND_PORT:-3000}"
DEMO_RTSP_PORT="${DEMO_RTSP_PORT:-$(envget DEMO_RTSP_PORT)}"; DEMO_RTSP_PORT="${DEMO_RTSP_PORT:-8554}"

API="http://127.0.0.1:${BACKEND_PORT}"
FRONT="http://127.0.0.1:${FRONTEND_PORT}"
DEMO_EMAIL="${DEMO_EMAIL:-owner@demo.com}"
DEMO_PASSWORD="${DEMO_PASSWORD:-password123}"
export CAM_NAME="${DEMO_CAM_NAME:-Webcam Demo (Local)}"
RTSP_URL_INNET="rtsp://aire-mediamtx:8554/cam"   # how the bridge (in Docker) reaches it
RTSP_URL_HOST="rtsp://127.0.0.1:${DEMO_RTSP_PORT}/cam"  # how the host publisher reaches it
PIDFILE="${TMPDIR:-/tmp}/aire-demo-webcam.pid"
PUBLOG="${TMPDIR:-/tmp}/aire-demo-webcam.log"

say()  { printf '\033[36m[demo-cctv]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  ! \033[0m%s\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Tiny JSON reader: pipe JSON in, pass a JS expr over `d`. e.g. echo "$j" | njs 'd.accessToken'
njs() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=s?JSON.parse(s):null;let r;try{r=eval(process.argv[1])}catch(e){r=""}console.log(r==null?"":r)})' "$1"; }

# --- OS-specific webcam capture args ---------------------------------------
detect_webcam_input() {  # populates global array WEBCAM_IN[]
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      local dev="${DEMO_WEBCAM:-}"
      if [ -z "$dev" ]; then
        dev="$(ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 \
               | grep -iE '\(video\)' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
      fi
      [ -n "$dev" ] || die "No DirectShow webcam found. Set DEMO_WEBCAM=\"<device name>\"."
      say "webcam device: $dev"
      WEBCAM_IN=(-f dshow -rtbufsize 100M -video_size 640x480 -framerate 15 -i "video=$dev") ;;
    Darwin)
      local dev="${DEMO_WEBCAM:-0}"
      WEBCAM_IN=(-f avfoundation -framerate 15 -video_size 640x480 -i "$dev") ;;
    *)
      local dev="${DEMO_WEBCAM:-/dev/video0}"
      WEBCAM_IN=(-f v4l2 -framerate 15 -video_size 640x480 -i "$dev") ;;
  esac
}

# --- API helpers ------------------------------------------------------------
login() {
  local r; r="$(curl -s -m 10 -X POST "$API/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")"
  TOKEN="$(printf '%s' "$r" | njs 'd.accessToken')"
  [ -n "$TOKEN" ] || die "Login failed for $DEMO_EMAIL (is the backend up on $API?)"
}
api() { curl -s -m 15 -H "Authorization: Bearer $TOKEN" "$@"; }

stop_publisher() {
  if [ -f "$PIDFILE" ]; then
    local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) taskkill //F //PID "$pid" >/dev/null 2>&1 || true ;; esac
    rm -f "$PIDFILE"
  fi
}

# ===========================================================================
cmd_up() {
  command -v docker  >/dev/null || die "docker not found"
  command -v ffmpeg  >/dev/null || die "ffmpeg not found (install it, then re-run)"
  command -v node    >/dev/null || die "node not found"
  docker compose ps --format '{{.Name}}' 2>/dev/null | grep -q aire-backend \
    || die "AIRE stack not running. Start it first: docker compose up -d"

  say "1/6  starting demo RTSP server (MediaMTX)…"
  docker compose --profile demo up -d mediamtx >/dev/null 2>&1 \
    && ok "aire-mediamtx up on 127.0.0.1:${DEMO_RTSP_PORT}" || die "failed to start mediamtx"

  say "2/6  publishing this laptop's webcam → RTSP…"
  detect_webcam_input
  stop_publisher
  nohup ffmpeg -hide_banner -loglevel warning "${WEBCAM_IN[@]}" \
      -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 -an \
      -f rtsp -rtsp_transport tcp "$RTSP_URL_HOST" >"$PUBLOG" 2>&1 &
  echo $! > "$PIDFILE"; disown 2>/dev/null || true
  sleep 4
  docker logs aire-mediamtx 2>&1 | grep -q "is publishing to path 'cam'" \
    && ok "webcam publishing (see $PUBLOG)" \
    || warn "publisher may still be warming up — check $PUBLOG if the feed is black"

  say "3/6  demo account → bridge pairing token…"
  login
  local outlet; outlet="$(api "$API/api/outlets" | njs 'd[0].id')"
  [ -n "$outlet" ] || die "no outlets for $DEMO_EMAIL"
  local bid; bid="$(api "$API/api/bridges" | njs "(d.find(x=>x.outletId==='$outlet')||{}).id")"
  local pt
  if [ -n "$bid" ]; then
    pt="$(api -X POST "$API/api/bridges/$bid/rotate-token" | njs 'd.pairingToken')"
  else
    local r; r="$(api -X POST "$API/api/bridges" -H 'Content-Type: application/json' \
        -d "{\"outletId\":\"$outlet\",\"name\":\"Demo Bridge\"}")"
    bid="$(printf '%s' "$r" | njs 'd.bridge.id')"; pt="$(printf '%s' "$r" | njs 'd.pairingToken')"
  fi
  [ -n "$pt" ] || die "could not mint a bridge pairing token"
  ok "bridge $bid paired"

  say "4/6  (re)starting branch-bridge in REAL mode…"
  AIRE_SIMULATE=false AIRE_BRIDGE_TOKEN="$pt" \
    docker compose -f docker-compose.yml -f docker-compose.bridge.yml up -d branch-bridge >/dev/null 2>&1 \
    || die "failed to start branch-bridge"
  # wait for cloud connection
  for _ in $(seq 1 10); do
    sleep 2
    curl -s -m 4 http://127.0.0.1:4010/health 2>/dev/null | grep -q '"cloud_connected":true' && break
  done
  ok "branch-bridge connected (simulate=false)"

  say "5/6  registering the webcam as a camera…"
  local cams cam
  cams="$(api "$API/api/cctv/cameras?outletId=$outlet")"
  cam="$(printf '%s' "$cams" | njs "(d.find(x=>x.name===process.env.CAM_NAME)||{}).id")"
  if [ -z "$cam" ]; then
    cam="$(api -X POST "$API/api/cctv/cameras" -H 'Content-Type: application/json' \
        -d "{\"outletId\":\"$outlet\",\"name\":\"$CAM_NAME\",\"rtspUrl\":\"$RTSP_URL_INNET\",\"bridgeId\":\"$bid\",\"location\":\"This laptop\"}" \
        | njs 'd.id')"
    ok "camera created: $CAM_NAME"
  else
    api -X PATCH "$API/api/cctv/cameras/$cam" -H 'Content-Type: application/json' \
        -d "{\"rtspUrl\":\"$RTSP_URL_INNET\",\"isActive\":true}" >/dev/null
    ok "camera reused: $CAM_NAME"
  fi
  [ -n "$cam" ] || die "failed to register camera"

  say "6/6  starting live stream + verifying frames…"
  curl -s -m 8 "$API/api/cctv/cameras/$cam/live.m3u8?access_token=$TOKEN" >/dev/null
  local segs=0
  for i in $(seq 1 10); do
    sleep 3
    segs="$(curl -s -m 6 "$API/api/cctv/cameras/$cam/live.m3u8?access_token=$TOKEN" | grep -c '\.ts')"
    [ "${segs:-0}" -ge 2 ] && break
  done
  [ "${segs:-0}" -ge 2 ] && ok "live HLS flowing ($segs segments)" \
    || warn "no segments yet — the dashboard will start it on open; give it a few seconds"

  printf '\n\033[32m════════ CCTV demo is live ════════\033[0m\n'
  printf '  Dashboard : %s   (login: %s / %s)\n' "$FRONT" "$DEMO_EMAIL" "$DEMO_PASSWORD"
  printf '  Camera    : "%s"  → outlet CCTV page\n' "$CAM_NAME"
  printf '  Stop with : scripts/demo-cctv.sh down\n\n'
}

cmd_status() {
  printf 'MediaMTX  : %s\n' "$(docker ps --format '{{.Status}}' -f name=aire-mediamtx 2>/dev/null | head -1 || echo 'not running')"
  printf 'Webcam pub: %s\n' "$([ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && echo running || echo stopped)"
  printf 'Bridge    : %s\n' "$(curl -s -m 4 http://127.0.0.1:4010/health 2>/dev/null || echo unreachable)"
  printf 'Dashboard : %s  (login %s / %s)\n' "$FRONT" "$DEMO_EMAIL" "$DEMO_PASSWORD"
}

cmd_down() {
  say "stopping webcam publisher…"; stop_publisher; ok "publisher stopped"
  say "stopping MediaMTX…"; docker compose --profile demo stop mediamtx >/dev/null 2>&1 || true; ok "mediamtx stopped"
  say "the demo camera + bridge are left in place (harmless). Re-run 'up' to resume."
}

case "${1:-up}" in
  up|"")   cmd_up ;;
  status)  cmd_status ;;
  down|stop) cmd_down ;;
  *) echo "usage: $0 [up|status|down]"; exit 1 ;;
esac
