# MatterCameras

> **Beta (pre-1.0)** — current version in `package.json` (e.g. `0.3.1-beta`). Bumped +0.0.1 on each deploy; verify server with `curl http://<host>:3202/api/version`.

Bridge RTSP/ONVIF cameras into **Matter 1.5 Camera** devices for SmartThings (Aeotec Hub v2) and other Matter controllers.

## Architecture

```
RTSP/ONVIF → go2rtc (WebRTC) → Matter Bridge (matter.js 0.17) → SmartThings Hub
```

- **Matter bridge** — bridged `Camera` endpoints (type `0x0142`) with AV Stream + WebRTC clusters
- **go2rtc** — RTSP ingest and WebRTC SDP exchange
- **Web UI** — add/remove cameras, Matter pairing QR, motion sensitivity

## Quick start (test install)

**Requirements:** Docker + Compose v2, **Node.js 22+** (setup compiles `dist/` for Docker), a Matter 1.5–capable hub, and at least one RTSP camera on the same LAN.

```bash
git clone https://github.com/patricktd/MatterCameras.git
cd MatterCameras
bash scripts/setup.sh
```

The script detects your LAN IP, creates `data/config.json` / `data/go2rtc.yaml` / `.env`, runs `npm ci && npm run build`, and starts **go2rtc** + **app** in Docker.

Then open `http://<your-lan-ip>:3202`, pair the Matter QR in SmartThings, and add a camera.

**Full walkthrough:** [docs/INSTALL.md](docs/INSTALL.md) (pairing, ports, troubleshooting, dev mode).

If LAN IP detection fails:

```bash
bash scripts/setup.sh --host 192.168.1.50
```

## Documentation

| Doc | Audience |
|-----|----------|
| **[docs/INSTALL.md](docs/INSTALL.md)** | Testers — first install, pairing, cameras |
| **[docs/SCALING.md](docs/SCALING.md)** | Operators — hardware limits and camera count |
| **[docs/MATTER-CAMERA.md](docs/MATTER-CAMERA.md)** | Integrators — Matter features vs SmartThings |
| **[docs/WEBRTC-DEBUG.md](docs/WEBRTC-DEBUG.md)** | Debugging live view / ICE / TURN |
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Maintainers — rsync deploy to production host |
| **[docs/AGENT-CONTEXT.md](docs/AGENT-CONTEXT.md)** | AI / contributor handoff |
| **[CHANGELOG.md](CHANGELOG.md)** | Version history and system overview |

## Development

```bash
npm install
npm start          # TypeScript via tsx (set matterHost in data/config.json)
npm run build      # compile to dist/
```

Local Docker stack: `./scripts/setup.sh` then `docker compose logs -f app`.  
App-only on host: `./scripts/setup.sh --dev` and `docker compose up -d go2rtc`.

## Status (beta)

- [x] Matter 1.5 Camera device type (bridged)
- [x] Live view WebRTC (iOS + Android SmartThings app)
- [x] JPEG snapshots and card preview
- [x] Motion events (Zone Management + OccupancySensing + RTSP frame-diff)
- [ ] ONVIF auto-discovery
- [ ] Cloud recording (Push AV Stream Transport — see `docs/MATTER-CAMERA.md`)

## Repository

https://github.com/patricktd/MatterCameras
