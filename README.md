# Matter Cameras Bridge

![GitHub release](https://img.shields.io/github/v/release/patricktd/MatterCameras?include_prereleases&label=version)

> **Beta (pre-1.0)** — version is set in `package.json` and bumped only on release (`npm run release`). Verify with `curl http://<host>:3202/api/version`.

![Matter Cameras Bridge dashboard — pairing, camera list, and live previews](docs/images/dashboard.png)

**Matter-compatible bridge** that exposes RTSP/ONVIF cameras as **Matter 1.5 Camera** endpoints on any Matter 1.5–capable hub or controller. This is **not** a Matter-certified product.

> **Trademark notice:** Matter is a trademark of the [Connectivity Standards Alliance](https://csa-iot.org/). Matter Cameras Bridge is an independent open-source project — **not affiliated with the CSA** and **not** a Matter-certified device. It works with Matter; it is not a Matter product.

**Primary test platform:** [SmartThings](https://www.smartthings.com/) standalone hub with **Matter 1.5 camera** firmware. Other Matter hubs may work at the protocol level as they add camera support — see [docs/MATTER-CAMERA.md](docs/MATTER-CAMERA.md) for the feature matrix and known hub differences.

## Architecture

```
RTSP/ONVIF → go2rtc (WebRTC) → Matter-compatible bridge (matter.js 0.17) → Matter hub / controller
```

- **Bridge** — bridged `Camera` endpoints (type `0x0142`) with AV Stream + WebRTC clusters
- **go2rtc** — RTSP ingest and WebRTC SDP exchange
- **Web UI** — add/remove cameras, Matter pairing QR, motion sensitivity

## Quick start

**Host OS:** **Linux or macOS** on the same LAN as your Matter hub and cameras. (Windows is not supported as the bridge host — see [docs/INSTALL.md](docs/INSTALL.md).)

> **First run needs internet** to pull images. After that, the bridge runs on your LAN.

> **Security:** the Web UI has **no login**. Run it only on a **trusted home LAN**. Do not expose port 3202 to the internet without a separate access layer.

There are two ways to install — pick one:

### Option A — Build from source (default, one-click in-app updates)

The original flow: clone the repo and let the setup script build and run everything. Enables the in-app **Update now** button (git checkout + rebuild).

**Requirements:** Docker + Compose v2, **Node.js 22+** (the setup script compiles `dist/` on the host before Docker starts), a Matter hub with **Matter 1.5 camera** support, and at least one RTSP/ONVIF camera.

```bash
git clone https://github.com/patricktd/MatterCameras.git
cd MatterCameras
bash scripts/setup.sh
```

The script detects your LAN IP, creates `data/config.json` / `data/go2rtc.yaml` / `.env`, runs `npm ci && npm run build`, and starts **go2rtc** + **app** in Docker.

### Option B — Pre-built image (Portainer / CasaOS / docker)

Run published images from the GitHub Container Registry. **No clone, no Node.js, no build.** Two files, pick the one for your setup:

**CasaOS / Portainer** — import **[docker-compose.casaos.yml](docker-compose.casaos.yml)**, then edit `LAN_IP` (go2rtc) and `MATTER_HOST` (app) to this machine's LAN IPv4 in the app's settings. Every value is concrete (these UIs do not read a `.env`), and it carries an `x-casaos` block (title, icon, Web UI port).

**Plain docker (CLI)** — use **[docker-compose.cli.yml](docker-compose.cli.yml)** with a `.env`:

```bash
cp .env.cli.example .env      # set LAN_IP in .env
docker compose -f docker-compose.cli.yml up -d
```

The app keeps its data in a Docker **named volume** and the go2rtc config ships **inside the image**, so nothing is seeded on the host. **Update later:** `docker compose -f <file> pull && up -d`.

> Requires **Linux with host networking** (Matter mDNS). To run your own fork's images, set `IMAGE_OWNER` in `.env` (CLI) or edit the two `image:` lines (CasaOS).

---

Either way, then open `http://<your-lan-ip>:3202`, pair the Matter QR in your hub app, and add a camera.

**Full walkthrough:** [docs/INSTALL.md](docs/INSTALL.md) (pairing, camera providers, ports, troubleshooting, updates).

## Video walkthrough

**[Installation and pairing demo on YouTube](https://youtu.be/-iBD2aoOA4I)** — narrated in **Portuguese**. Turn on **subtitles (CC)** for a clear walkthrough in other languages.

If LAN IP detection fails:

```bash
bash scripts/setup.sh --host 192.168.1.50
```

## Documentation

| Doc | Audience |
|-----|----------|
| **[docs/INSTALL.md](docs/INSTALL.md)** | **Start here** — install, pairing, cameras, updates |
| **[docs/MATTER-CAMERA.md](docs/MATTER-CAMERA.md)** | Feature matrix vs hub capabilities |
| **[docs/SCALING.md](docs/SCALING.md)** | Hardware limits and camera count |
| **[docs/WEBRTC-DEBUG.md](docs/WEBRTC-DEBUG.md)** | Debugging live view / ICE / TURN |
| **[CHANGELOG.md](CHANGELOG.md)** | Version history |

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
- [x] Live view WebRTC (iOS + Android — verified on SmartThings)
- [x] JPEG snapshots and card preview
- [x] Motion events (Zone Management + OccupancySensing + RTSP frame-diff or ONVIF PullPoint)
- [x] ONVIF WS-Discovery (Web UI scan + REST API)
- [ ] ONVIF periodic auto-discovery (background rescan)
- [ ] Cloud recording (Push AV Stream Transport — see `docs/MATTER-CAMERA.md`)

## Repository

Source code: [github.com/patricktd/MatterCameras](https://github.com/patricktd/MatterCameras) (repository folder name unchanged).
