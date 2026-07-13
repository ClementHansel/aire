# AIRE demo scripts

## `demo-cctv.sh` — laptop webcam as a branch CCTV camera

Turns the laptop's webcam into a live camera in the dashboard, using the seeded
demo account. Built for sales/support demos — especially the 2-laptop setup
where one laptop plays the role of a physical branch.

### Prerequisites (on the machine running it)

- Docker Desktop, with the AIRE stack already up: `docker compose up -d`
- **ffmpeg** on `PATH`
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- A webcam

### Use

```bash
pnpm demo:cctv          # or: bash scripts/demo-cctv.sh up
pnpm demo:cctv:down     # or: bash scripts/demo-cctv.sh down
bash scripts/demo-cctv.sh status
```

`up` is idempotent — safe to re-run any time (e.g. if the feed goes black).
It: starts a MediaMTX RTSP server (`--profile demo`), publishes the webcam into
it, mints a bridge pairing token via the demo account, runs the branch-bridge in
real mode, registers/reuses a `Webcam Demo (Local)` camera, and starts the live
stream. When done it prints the dashboard URL + demo login.

**View it:** open the dashboard (printed at the end, e.g. `http://127.0.0.1:53000`),
log in as `owner@demo.com` / `password123`, and open the outlet's CCTV page →
`Webcam Demo (Local)`.

### Overrides (env)

| var | default | meaning |
|-----|---------|---------|
| `DEMO_WEBCAM` | auto-detect (Win) / `0` (mac) / `/dev/video0` (linux) | webcam device |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `owner@demo.com` / `password123` | demo login |
| `DEMO_CAM_NAME` | `Webcam Demo (Local)` | camera name in the dashboard |
| `DEMO_RTSP_PORT` | `8554` | host port for the demo RTSP server |

## Two ways to demo the webcam-as-CCTV — pick per scenario

There are **two buttons**; use whichever fits the demo:

### Button A — `pnpm demo:cctv` (one laptop, all-in-Docker)

The script above. Everything runs on the presenter's laptop: MediaMTX + a webcam
publisher + the Docker branch-bridge relay. Fastest for a solo laptop demo.

### Button B — real 2-laptop branch (native install + built-in webcam)

Closer to production. **Laptop A** = cloud (`docker compose up -d`); **Laptop B**
= the "branch":

1. On Laptop A's dashboard: **Settings → Branch Bridges → Add bridge**, pick the
   branch, and tick **"Use this PC's built-in webcam as a camera."** That
   registers a `webcam:` camera bound to the bridge (no IP camera needed).
2. Copy the pairing token / download the installer, move it to **Laptop B**, and
   install the agent **natively** (Docker Desktop on Win/macOS can't reach the USB
   webcam, so the agent must run native):

   ```powershell
   # Windows (elevated PowerShell, in the extracted installer folder)
   .\install.ps1 -Token "<token>" -CloudUrl "http://<laptop-A-ip>:54000" -Webcam
   ```
   ```bash
   # Linux
   sudo ./install.sh --token "<token>" --cloud-url "http://<laptop-A-ip>:54000" --webcam
   ```

The agent then **captures Laptop B's own webcam** (`webcam:` source — auto-detects
the device; pin one with `-WebcamDevice "Integrated Camera"` / `--webcam-device`)
and relays it to the dashboard as a branch camera. `-Webcam` makes ffmpeg a hard
requirement.

> The bridge relays RTSP or, with a `webcam:` camera, captures the host webcam
> directly. Never run the bridge with `AIRE_SIMULATE=true` for a webcam/RTSP demo
> — simulate mode streams a synthetic test pattern and ignores the real source.
> (`demo-cctv.sh` and the installer handle this for you.)
