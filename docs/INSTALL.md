# Installation guide

Step-by-step setup for **Matter Cameras Bridge** on your own LAN with a Matter 1.5 camera–capable hub.

> **Trademark notice:** Matter is a trademark of the Connectivity Standards Alliance. This project is an independent Matter-compatible bridge — not affiliated with the CSA and not a Matter-certified product.

## What you need

| Requirement | Notes |
|-------------|--------|
| **Linux or macOS host** | Same subnet as your Matter hub and cameras. **Windows is not supported** as the bridge host (Docker + Matter mDNS on Windows is out of scope for this guide). |
| **Docker** + Compose v2 | **Required for both paths.** Option A builds locally (`bash scripts/setup.sh`); Option B runs pre-built images. |
| **Node.js 22+** | Only for **Option A (build from source)** — `setup.sh` runs `npm ci && npm run build` on the host. **Not needed** for the pre-built image install (Option B). |
| **Internet (first install)** | `docker compose up --build` pulls/builds images from Docker Hub. Offline or blocked registry → build fails; see [Troubleshooting](#troubleshooting) |
| **Matter hub** | Firmware that supports **Matter 1.5 cameras**. **SmartThings** is the primary reference platform; Google Home / Apple Home camera support is still rolling out in many regions — verify your hub before relying on live view. |
| **RTSP or ONVIF camera** | H.264 native is best; H.265 works via ffmpeg transcode (more CPU) |
| **Open ports on the host** | See [Ports](#ports) below |

### Security

The Web UI on port **3202** has **no username or password**. Anyone on your LAN can add cameras, change settings, or trigger a Matter factory reset. Use only on a **trusted home network**. Do not port-forward 3202 to the internet.

## Quick install (Docker)

Pick one path. Both run the same two-container stack (`go2rtc` + `app`) with `network_mode: host`.

### Option A — Build from source (default)

Clone and let the setup script build and run everything. Enables the in-app **Update now** button. Requires **Node.js 22+**.

```bash
git clone https://github.com/patricktd/MatterCameras.git
cd MatterCameras
bash scripts/setup.sh
```

`setup.sh`:

1. Detects your LAN IP (or use `bash scripts/setup.sh --host 192.168.1.50`)
2. Creates `data/config.json`, `data/go2rtc.yaml`, `data/cameras.json`, and `.env` from templates (only if missing)
3. Runs `npm ci && npm run build` (populates `dist/` for the Docker bind-mount)
4. Builds and starts **go2rtc** + **app** with `network_mode: host`

### Option B — Pre-built image (Portainer / CasaOS / docker)

Run published images from GHCR. **No clone, no Node.js, no build, no seeded files.** The app keeps its data in a Docker named volume, and the go2rtc config ships inside the image (`LAN_IP` fills the WebRTC candidates at startup). Two files, pick one:

**CasaOS / Portainer** — import **[docker-compose.casaos.yml](../docker-compose.casaos.yml)**, then edit `LAN_IP` (go2rtc) and `MATTER_HOST` (app) to this machine's LAN IPv4 in the app's settings. Every value is concrete (these UIs do not read a `.env` and do not expand `${VAR:-default}`); it also carries an `x-casaos` block (title, icon, Web UI port).

**Plain docker (CLI)** — use **[docker-compose.cli.yml](../docker-compose.cli.yml)** with a `.env`:

```bash
cp .env.cli.example .env      # set LAN_IP in .env
docker compose -f docker-compose.cli.yml up -d
# or inline: LAN_IP=192.168.1.50 docker compose -f docker-compose.cli.yml up -d
```

Always set `LAN_IP`/`MATTER_HOST` to the correct IP: left at the sample value the stack still starts, but Matter pairing and WebRTC will not work. To run your own fork's images, set `IMAGE_OWNER` in `.env` (CLI) or edit the two `image:` lines (CasaOS). Requires **Linux with host networking** (Matter mDNS); Docker Desktop on Windows/macOS does not provide host networking the same way.

Open the Web UI at `http://<your-lan-ip>:3202`.

### Software updates

How you update depends on the install path:

- **Option A (build from source):** one-click **Update now** in the Web UI, described below.
- **Option B (pre-built image):** `docker compose -f docker-compose.cli.yml pull && up -d` (or `docker-compose.casaos.yml`). The in-app **Update now** button is hidden in this mode: there is no host git checkout to rebuild.

For Option A, install from a **git clone** (`git clone https://github.com/patricktd/MatterCameras.git`) so the bridge can update itself.

The dashboard checks [GitHub](https://github.com/patricktd/MatterCameras/releases) for newer version tags. When one is available, click **Update now** on the banner or under **Options → Software updates**. The bridge checks out the tag, rebuilds, and restarts Docker — `data/cameras.json`, `data/matter-storage/`, and pairing are preserved.

Requires Docker (default `docker compose up`) on a **trusted LAN** — the Web UI has no login.

**Manual update** (SSH fallback):

```bash
cd MatterCameras
bash scripts/self-update.sh          # latest main
bash scripts/self-update.sh 0.4.1-beta   # specific tag
```

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
5. Wait until the bridge appears as **Matter Cameras Bridge** (or the name your hub shows for the paired aggregator).

> **Important:** `matterHost` in `data/config.json` must be the bridge machine’s **LAN IP**, not `127.0.0.1`. The setup script sets this automatically. If you move the bridge to another machine, re-run `./scripts/setup.sh --host <new-ip>` on fresh data or edit `data/config.json` and `data/go2rtc.yaml` (WebRTC `candidates` / `filters.ips`).

## Add a camera

Web UI → **Add Camera** — pick a provider:

| Provider | Best for |
|----------|----------|
| **UniFi Protect** | Cameras on a UniFi Protect controller; bulk import; native Protect motion |
| **Reolink** | Reolink cameras/NVR — login fills RTSP URL; optional spotlight / person sensor |
| **ONVIF** | Generic ONVIF cameras — **Scan LAN (5s)** on UDP 3702, then **Use** on a device |
| **Tapo / Sonoff** | Tapo or Sonoff cameras using the app camera-account credentials |
| **Manual RTSP** | Any camera — paste `rtsp://user:pass@host:554/...` |

### UniFi Protect

1. **Add Camera** → **UniFi Protect**
2. Enter controller host, user, and password (or save once under **Options → UniFi Protect controller**)
3. List cameras, select those with RTSP enabled in Protect, import

Cameras without an RTSP alias in Protect must have RTSP enabled under camera **Advanced** settings first.

### Reolink

1. **Add Camera** → **Reolink**
2. Enter camera/NVR IP, username, password
3. Pick channel/stream; optional person-presence sensor and spotlight endpoints in Advanced

### ONVIF scan

1. **Add Camera** → **ONVIF**
2. Enter shared **ONVIF username** and **password**
3. Click **Scan LAN (5s)** — WS-Discovery on UDP 3702 (same subnet as the bridge host)
4. Click **Use** on a discovered camera — the form fills with name, RTSP URL, and ONVIF URL
5. Review and click **Add Camera**

If ONVIF is on a non-standard port, set **ONVIF device URL** under Advanced after scan.

### Manual RTSP URL

1. **Add Camera** → **Manual RTSP**
2. Name + RTSP URL, e.g. `rtsp://user:pass@192.168.1.100:554/stream1`
3. Save — the bridge registers the stream in go2rtc and exposes a new bridged Matter camera endpoint.
4. In your hub app, open the bridge device and confirm the new camera appears (may take a short hub sync).

**Motion (Advanced):** default **Frame diff** works on any RTSP. Choose **ONVIF events** if the camera supports ONVIF motion (lower CPU). UniFi and Reolink cameras can use vendor-native motion when configured.

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

# Version
curl -s http://127.0.0.1:3202/api/version
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

Environment variables (override file config): `MATTER_HOST`, `MATTER_BIND_HOST`, `MATTER_PORT`, `WEB_PORT`, `GO2RTC_URL`, `TZ`, `GITHUB_REPO` (repo polled for update notifications), `MATTER_PASSCODE`, `MATTER_DISCRIMINATOR`.

For the **pre-built image** install, [docker-compose.casaos.yml](../docker-compose.casaos.yml) uses concrete image tags (edit the two `image:` lines for a fork), while [docker-compose.cli.yml](../docker-compose.cli.yml) is env-driven via [.env.cli.example](../.env.cli.example).

## Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| `setup.sh` fails on Docker build | Internet and access to `registry-1.docker.io`; retry later. If images already exist: `docker compose up -d` (no `--build`) after `npm run build` |
| Connection refused on :3202 | `docker compose ps` — containers may be down after a failed `up --build`; run `docker compose up -d` |
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

- [MATTER-CAMERA.md](MATTER-CAMERA.md) — feature matrix vs hub capabilities
- [SCALING.md](SCALING.md) — hardware and camera count limits
