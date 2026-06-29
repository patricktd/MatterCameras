# Installation guide (testers)

Step-by-step setup for trying **MatterCameras** on your own LAN with a Matter 1.5 camera–capable hub.

## What you need

| Requirement | Notes |
|-------------|--------|
| **Linux or macOS host** | Same subnet as your Matter hub and cameras |
| **Docker** + Compose v2 | Recommended path (`bash scripts/setup.sh`) |
| **Node.js 22+** | Required for Docker install too — setup compiles `dist/` before `docker compose` |
| **Matter hub** | Firmware that supports **Matter 1.5 cameras** (e.g. Aeotec / SmartThings standalone hub) |
| **RTSP camera** | H.264 native is best; H.265 works via ffmpeg transcode (more CPU) |
| **Open ports on the host** | See [Ports](#ports) below |

Optional: **Node.js 22+** if you prefer running the app on the host (`--dev`) while go2rtc runs in Docker.

## Quick install (Docker)

```bash
git clone https://github.com/patricktd/MatterCameras.git
cd MatterCameras
bash scripts/setup.sh
```

The script:

1. Detects your LAN IP (or use `bash scripts/setup.sh --host 192.168.1.50`)
2. Creates `data/config.json`, `data/go2rtc.yaml`, `data/cameras.json`, and `.env` from templates (only if missing)
3. Runs `npm ci && npm run build` (populates `dist/` for the Docker bind-mount)
4. Builds and starts **go2rtc** + **app** with `network_mode: host`

Open the Web UI at `http://<your-lan-ip>:3202`.

### Ports

| Port | Service |
|------|---------|
| 3202 | Web UI |
| 3203 | go2rtc API |
| 5550 | Matter (TCP/UDP) |
| 8554 | RTSP relay |
| 8555 | WebRTC (TCP/UDP) |
| 5353 | mDNS (UDP) |

Ensure nothing else on the host binds these ports before starting.

## Pair with your Matter hub

1. Update the hub to firmware that supports **Matter 1.5 cameras**.
2. Open the Web UI on a device on the same LAN.
3. In the **Matter pairing** section, scan the QR code (or enter the manual pairing code).
4. In your hub app, add a Matter device and scan the QR (e.g. SmartThings: **Add device → Matter → scan QR**).
5. Wait until the bridge appears as a Matter device.

> **Important:** `matterHost` in `data/config.json` must be the bridge machine’s **LAN IP**, not `127.0.0.1`. The setup script sets this automatically. If you move the bridge to another machine, re-run `./scripts/setup.sh --host <new-ip>` on fresh data or edit `data/config.json` and `data/go2rtc.yaml` (WebRTC `candidates` / `filters.ips`).

## Add a camera

### Option A — ONVIF scan (recommended when cameras support ONVIF)

1. Web UI → **+ Add Camera**
2. Enter **ONVIF username** and **password** (shared across discovered devices)
3. Click **Scan LAN (5s)** — WS-Discovery on UDP 3702 (same subnet as the bridge host)
4. Click **Use** on a discovered camera — the form fills with name, RTSP URL, and ONVIF URL
5. Review and click **Add Camera**

If ONVIF is on a non-standard port, set **ONVIF device URL** under Advanced after scan.

### Option B — manual RTSP URL

1. Web UI → **Add camera**
2. Name + RTSP URL, e.g. `rtsp://user:pass@192.168.1.100:554/stream1`
3. Save — the bridge registers the stream in go2rtc and exposes a new bridged Matter camera endpoint.
4. In your hub app, open the bridge device and confirm the new camera appears (may take a short hub sync).

**Motion (Advanced):** default **Frame diff** works on any RTSP. Choose **ONVIF events** if the camera supports ONVIF motion (lower CPU).

### More than 4 cameras (hub app limits)

Live view works for all bridged cameras on the bridge. Some hub apps (including **SmartThings**) only let you pick **4 cameras** for cloud monitoring **card previews** — cameras outside that selection may show empty cards. On SmartThings, change the selection in **Home Monitor → Cameras**.

### No camera yet?

You can test stream plumbing with a public RTSP test feed (latency/quality vary; not for production):

```
rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4
```

Prefer a real camera on your LAN for WebRTC live view testing.

## Verify services

```bash
# Containers running
docker compose ps

# App logs
docker compose logs -f app

# go2rtc API
curl -s http://127.0.0.1:3203/api | head

# Matter / Web UI ports
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3202/
```

## Development mode (no Docker for the app)

Useful when editing TypeScript locally. You still need go2rtc (run only the go2rtc service, or full compose in another terminal).

```bash
./scripts/setup.sh --dev
docker compose up -d go2rtc   # in another terminal, if not already running
npm start
```

## Configuration reference

| File | Purpose |
|------|---------|
| `data/config.json` | `matterHost`, ports, go2rtc URL (created by `setup.sh`; **do not commit**) |
| `data/cameras.json` | Camera roster (created on first add; do not delete casually after pairing) |
| `data/go2rtc.yaml` | WebRTC ICE candidates (must match LAN IP; **do not commit**) |
| `data/matter-storage/` | Matter fabric — **do not delete** after pairing |
| `.env` | Optional overrides for Docker Compose |

Environment variables (override file config): `MATTER_HOST`, `MATTER_PORT`, `WEB_PORT`, `GO2RTC_URL`, `MATTER_PASSCODE`, `MATTER_DISCRIMINATOR`.

## Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| Hub cannot find bridge | Same VLAN/subnet; UDP 5353 not blocked; `matterHost` is LAN IP |
| Live view black / timeout | WebRTC port **8555** open host↔hub; see [WEBRTC-DEBUG.md](WEBRTC-DEBUG.md) |
| Snapshot works, no video | Usually ICE/TURN — confirm `go2rtc.yaml` `candidates` IP |
| Camera added but not on hub | Restart app container; re-open bridge in the hub app |
| High CPU | H.265 transcode per camera; enable H.264 on the camera if possible |

## Stopping / reset

```bash
docker compose down
```

**Reset Matter pairing (destructive):** stop containers, delete `data/matter-storage/`, run setup again, re-pair the hub from scratch.

**Reset cameras only:** edit `data/cameras.json` via the Web UI (preferred). Deleting the file loses RTSP URLs; Matter endpoint IDs may still exist in `matter-storage/`.

## Next steps

- [SCALING.md](SCALING.md) — hardware and camera count limits
- [MATTER-CAMERA.md](MATTER-CAMERA.md) — feature matrix vs hub capabilities
- [DEPLOY.md](DEPLOY.md) — maintainer production deploy (rsync / remote host)
