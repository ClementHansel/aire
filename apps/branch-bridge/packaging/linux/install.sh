#!/usr/bin/env bash
# =============================================================================
# Aire Branch Bridge - Linux installer (systemd). No Docker required.
# Run from the extracted installer folder as root:
#   sudo ./install.sh --token <pairing-token> [--cloud-url https://app.useairin.id] [--simulate]
#   Demo webcam (relay this PC's camera): add --webcam [--webcam-device /dev/video0]
# =============================================================================
set -euo pipefail

CLOUD_URL="https://app.useairin.id"
TOKEN=""
SIMULATE="false"
WEBCAM="false"
WEBCAM_DEVICE=""
MQTT_URL="mqtt://localhost:1883"
HEALTH_PORT="4010"
INSTALL_DIR="/opt/aire-branch-bridge"
SERVICE="aire-branch-bridge"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --cloud-url) CLOUD_URL="$2"; shift 2;;
    --mqtt-url) MQTT_URL="$2"; shift 2;;
    --health-port) HEALTH_PORT="$2"; shift 2;;
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    --simulate) SIMULATE="true"; shift;;
    --webcam) WEBCAM="true"; shift;;
    --webcam-device) WEBCAM_DEVICE="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 1;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
[ -n "$TOKEN" ] || { echo "--token <pairing-token> is required."; exit 1; }

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ required (e.g. apt install nodejs)."; exit 1; }
NODE_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node.js 18+ required; found $(node -v)."; exit 1; }
NODE_BIN="$(command -v node)"

if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_PATH="$(command -v ffmpeg)"
elif [ "$WEBCAM" = "true" ]; then
  echo "ffmpeg is required for --webcam but was not found (apt install ffmpeg). Aborting."; exit 1
else
  echo "WARN: ffmpeg not found; CCTV won't work until installed (apt install ffmpeg). IoT works without it."
  FFMPEG_PATH="ffmpeg"
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
echo "Installing to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp -R "$SRC/dist" "$INSTALL_DIR/"
cp "$SRC/package.json" "$SRC/package-lock.json" "$INSTALL_DIR/" 2>/dev/null || true
if [ -d "$SRC/node_modules" ]; then
  cp -R "$SRC/node_modules" "$INSTALL_DIR/"
else
  ( cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund )
fi

# Dedicated unprivileged service user.
id aire-bridge >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin aire-bridge
chown -R aire-bridge:aire-bridge "$INSTALL_DIR"

# EnvironmentFile keeps the token out of the unit file.
cat > "$INSTALL_DIR/bridge.env" <<EOF
AIRE_CLOUD_URL=$CLOUD_URL
AIRE_BRIDGE_TOKEN=$TOKEN
AIRE_SIMULATE=$SIMULATE
AIRE_MQTT_URL=$MQTT_URL
FFMPEG_PATH=$FFMPEG_PATH
BRIDGE_HEALTH_PORT=$HEALTH_PORT
AIRE_WEBCAM_DEVICE=$WEBCAM_DEVICE
EOF
chmod 600 "$INSTALL_DIR/bridge.env"
chown aire-bridge:aire-bridge "$INSTALL_DIR/bridge.env"

sed -e "s#@INSTALL_DIR@#$INSTALL_DIR#g" -e "s#@NODE_BIN@#$NODE_BIN#g" \
  "$SRC/aire-branch-bridge.service" > "/etc/systemd/system/$SERVICE.service"

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl --no-pager status "$SERVICE" | head -n 8 || true

echo ""
echo "Installed. Health: http://localhost:$HEALTH_PORT/health"
echo "Logs: journalctl -u $SERVICE -f"
echo "The branch should show Online in the Aire dashboard within ~15s."
