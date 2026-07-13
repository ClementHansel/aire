# Aire Branch Bridge — PC installer

Install the on-prem bridge agent on a **branch PC** (Windows or Linux) so it runs
24/7 in the background — auto-starts on boot, auto-restarts on crash. **No Docker
required.** The PC needs to be on the same network as the branch's cameras / bay
controllers and stay powered on. (A cheap always-on mini-PC or the POS PC both
work; a phone/tablet is *not* supported for the agent — it's a viewer only.)

## 1. Build the installer package (done once, by the Aire team)

```
cd apps/branch-bridge
npm run package
```

Produces `packaging/dist-pkg/aire-branch-bridge/` (and a `.zip`) containing the
prebuilt agent + production dependencies + install scripts. Hand that zip to the
branch, or host it for download.

Prerequisite on the branch PC: **Node.js 18+** and **ffmpeg** (only needed for
CCTV; bay sensors work without it).
- Windows: `winget install OpenJS.NodeJS.LTS` and `winget install Gyan.FFmpeg`
- Debian/Ubuntu: `sudo apt install -y nodejs ffmpeg`

## 2. Get the pairing token

In the Aire dashboard: **Settings → Branch Bridges → Add bridge** for the branch.
Copy the one-time **pairing token** (and the install command shown there).

## 3. Install on the branch PC

**Windows** (extract the zip, then in an **Administrator** PowerShell, inside the
extracted folder):

```powershell
.\install.ps1 -Token "<pairing-token>" -CloudUrl "https://app.useairin.id"
```

**Linux** (as root, inside the extracted folder):

```bash
sudo ./install.sh --token "<pairing-token>" --cloud-url "https://app.useairin.id"
```

Add `-Simulate` / `--simulate` to run a hardware-free demo (ffmpeg test pattern,
fake devices) to validate connectivity before real cameras are wired.

Within ~15 seconds the branch shows **Online** in the dashboard. Then use
**Search devices** to discover + configure cameras and controllers, and the
**CCTV** page to view live / recorded video.

## Manage

| | Windows | Linux |
|---|---|---|
| Status | Task Scheduler → `AireBranchBridge` | `systemctl status aire-branch-bridge` |
| Logs | `%ProgramData%\AireBranchBridge\logs\agent.log` | `journalctl -u aire-branch-bridge -f` |
| Health | `http://localhost:4010/health` | same |
| Uninstall | `.\uninstall.ps1` (`-Purge` to delete files) | `sudo systemctl disable --now aire-branch-bridge` |

## How it works

The agent holds ONE outbound connection to the Aire cloud (`/socket.io/` → the
`/bridge` namespace) — no inbound ports, no port-forwarding. The cloud dispatches
scans/stream requests to it; the agent scans the LAN (ONVIF/mDNS/SSDP/port probe)
and relays camera video (RTSP→HLS via ffmpeg) and bay MQTT up that one socket.
See `../../../docs/tech/07-branch-bridge-protocol.md`.

## Docker alternative (for technical branches)

If the branch PC already runs Docker, skip the installer and use the one-liner
`docker run …` shown on bridge creation instead.
