# Changelog

All notable changes to **MatterCameras** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Repository: [github.com/patricktd/MatterCameras](https://github.com/patricktd/MatterCameras)

> **Project status:** pre-1.0 **beta**. Versions stay below `1.0.0` until the bridge is considered production-stable. `1.0.0` will mark the first stable release.

---

## System overview

**MatterCameras** is a bridge that exposes RTSP/ONVIF cameras as **Matter 1.5 Camera** devices (type `0x0142`) on a Matter hub — primarily **SmartThings** (Aeotec Hub v2) and other compatible controllers.

### Data flow

```
RTSP/ONVIF → go2rtc (WebRTC + snapshots) → Matter Bridge (matter.js 0.17) → Matter Hub
```

### Components

| Component | Path / service | Responsibility |
|-----------|----------------|----------------|
| **Node.js app** | `src/main.ts` | Orchestrates storage, Matter bridge, go2rtc, and Web UI |
| **Matter Bridge** | `src/matter/Bridge.ts` | Matter Aggregator (`0x0e`); adds bridged camera endpoints |
| **Bridged camera** | `src/matter/devices/BridgedCameraDevice.ts` | Camera device type `0x0142` with AV + WebRTC clusters |
| **AV Stream Management** | `src/matter/behaviors/MatterCameraAvStreamManagementServer.ts` | H.264 live view, JPEG snapshots, audio stub |
| **WebRTC Provider** | `src/matter/behaviors/MatterWebRtcTransportProviderServer.ts` | Matter ↔ go2rtc signaling (`ProvideOffer`, ICE trickle) |
| **go2rtc client** | `src/streaming/Go2RTCClient.ts` | Stream registration, ffmpeg transcode, WebRTC, frames |
| **Storage** | `src/storage/db.ts` | Camera persistence in `data/cameras.json` (lowdb) |
| **Web UI** | `src/web/server.ts` + `views/` | Express/EJS dashboard for management and pairing |
| **go2rtc** | `alexxit/go2rtc` container | RTSP ingest, WebRTC relay, HTTP/WS API |
| **Deploy** | `docker-compose.yml`, `scripts/deploy.sh` | Production with `network_mode: host` (mDNS/Matter) |

### Default ports (production)

| Port | Service |
|------|---------|
| 3202 | Web UI |
| 3203 | go2rtc API |
| 5550 | Matter (TCP/UDP) |
| 8554 | go2rtc RTSP relay |
| 8555 | WebRTC (TCP/UDP) |
| 5353 | mDNS (UDP) |

### Configuration

- File: `data/config.json`
- Environment variables: `MATTER_HOST`, `MATTER_PORT`, `WEB_PORT`, `GO2RTC_URL`, `MATTER_PASSCODE`, etc.
- Persistent data: `data/` (cameras, Matter fabric, `go2rtc.yaml`)

### Operational limits

See [docs/SCALING.md](docs/SCALING.md) for hardware recommendations, camera counts, and bottlenecks (ffmpeg, hub TURN, ~50 bridged devices on SmartThings).

---

## [Unreleased]

### Added
- **Deploy version bump** — `scripts/bump-deploy-version.mjs` increments `package.json` patch by +0.0.1 on each `npm run quick-deploy` / `npm run deploy`; verify server with `GET /api/version` or Web UI badge.
- `GET /api/diagnostics/snapshots` — per-camera go2rtc snapshot health check (hub-independent).
- `docs/INSTALL.md` — step-by-step tester guide (pairing, cameras, troubleshooting).
- `docs/DEPLOY.md` — production rsync deploy (moved out of README).
- `data/config.json.example` and `data/go2rtc.yaml.example` — host-agnostic templates for new installs.
- Web UI **Options** panel and **Restart Bridge** button.
- Matter 1.5 **Zone Management** (`0x0550`) with full-viewport motion zone and `ZoneTriggered` / `ZoneStopped` events for SmartThings routines.
- **OccupancySensing** cluster on bridged cameras for SmartThings routine picker (`motionSensor` capability after hub reprofile).
- Generic **RTSP motion detection** via go2rtc JPEG frame comparison (`MotionDetectionService`); no vendor-specific APIs.
- `docs/MATTER-CAMERA.md` — snapshots in notifications, motion routines, and cloud recording gap analysis.
- `docs/AGENT-CONTEXT.md` — agent handoff (deploy safety, feature matrix, known issues, log commands).
- `matterSoftwareVersion` (301) on bridged cameras to trigger SmartThings camera reprofile after new clusters.
- Docker bind-mount `./dist`, `./views`, and `./public` (read-only) so `quick-deploy.sh` updates running container without image rebuild.
- SmartThings **live view (WebRTC)** on **iOS and Android** — operator confirmed 2026-06-09; **audio (Opus)** on both platforms (see `docs/WEBRTC-DEBUG.md`).
- Hub offer SDP diagnostics (`setup`, fingerprint, candidate count) on each `ProvideOffer`.
- Android/compact-hub path: keep full hub ICE in go2rtc offer copy, prewarm before exchange, recycle on hub retry; inline bridge ICE candidates in answer SDP. Compact detection uses AND (small SDP + few candidates) so iOS is unaffected.
- `scripts/watch-webrtc-logs.sh` — filtered tail of Matter + go2rtc logs for live-view test sessions.

### Changed
- **Deploy workflow:** `npm run quick-deploy` / `npm run deploy` bump `package.json` patch (+0.0.1), build, and sync; `package.json` bind-mounted in Docker for live version badge and `GET /api/version`.
- README trimmed to quick start + documentation index; install tutorial lives in `docs/INSTALL.md`.
- Matter `prepareHubOfferForGo2rtc`: LAN-only hub candidates + internal `ice-lite` hint so the bridge can nominate ICE pairs.
- go2rtc WebRTC source `ffmpeg:…#video=h264#audio=opus` for Matter/SmartThings A/V.
- Camera add/remove while paired uses runtime Matter endpoint updates + `PartsList` / `softwareVersion` announce (no automatic restart); see `docs/MATTER-BRIDGE.md`.
- Motion detection: less sensitive frame-diff (hysteresis, debounce, changed-pixel ratio) and default zone sensitivity 3; reduces false triggers on outdoor cameras.
### Fixed
- **Reset Pairing UX:** factory reset now returns a status page (with auto-reconnect polling) before the process exits, and the Web UI starts early during boot so the dashboard is reachable within seconds instead of after the full WebRTC pre-warm (~50s).
- **Reset Pairing crash loop:** Web UI factory reset takes the bridge offline, closes Matter storage, and deletes all of `data/matter-storage/` before exit. Previously `server.erase()` left orphaned peer records; Docker restart then failed with `FabricNotFoundError` until manual storage cleanup.
- **Motion routines:** always update `OccupancySensing` on zone trigger/stop. SmartThings matter-switch maps `motionSensor` automations from occupancy, not `ZoneTriggered` events.
- **Hub sensitivity changes:** `createOrUpdateTrigger` from SmartThings now refreshes RTSP motion detector sensitivity live.
- **Live view signaling order:** defer `WebRtcTransportRequestor.answer` until after `ProvideOfferResponse` (hub creates session on response per Matter 1.5 §11.5.7.4). Fixes `NotFound (139)` on iOS/Android, enables fast first-attempt load; earlier Android “DTLS blocker” was this bug, not an app defect.
- Zone Management startup crash (`maxUserDefinedZones` must be ≥ 5 per Matter constraint).
- Snapshot previews preserve camera aspect ratio (`scale=width:-1` in go2rtc); Matter response reports actual JPEG dimensions instead of forcing 640×360.
- Hub `answer` delivery retry backoff when `NotFound (139)` is transient (kept alongside deferred signaling).
- Disabled go2rtc built-in STUN defaults explicitly with `ice_servers: []` in `data/go2rtc.yaml`; without that, the patched ice-lite bridge could still fail in `GetAnswer()` with `agent does not need URL with selected candidate types`.
- Removed the `VOLUME /config` declaration from the custom go2rtc image so the bind-mounted `data/go2rtc.yaml` is not masked by an anonymous Docker volume.
- Added a timeout to go2rtc offer exchange requests so a stuck WebRTC negotiation cannot hold the per-camera lock indefinitely and block later SmartThings attempts.
- Stopped forwarding hub `ice_servers` into go2rtc while the bridge runs as `ice-lite`; SmartThings live-view attempts on iOS and Android were failing in `GetAnswer()` with `agent does not need URL with selected candidate types`.
- Reduced bridge ICE export to a single host UDP RTP candidate when `rtcp-mux`/BUNDLE are in use; previous attempts were still sending two local candidates to the hub and ICE never selected a pair.
- Removed forced `ice-lite` from the custom go2rtc patch after live view still stalled in ICE `checking` with no selected candidate pair, even when signaling and candidate filtering were otherwise correct.
- Overlapping go2rtc PeerConnections when hub retried `ProvideOffer` during cold ffmpeg prewarm (STUN `error response`); fixed with single-lock exchange and per-camera offer queue.
- First live-view attempt sometimes failing on iOS while second succeeds (~5 s cold ffmpeg startup); boot prewarm mitigates; hub retry is expected behavior.

### Changed
- go2rtc is built from source (`docker/go2rtc/`) with Matter/SmartThings ICE patches: `MaxBindingRequests` 7→100 and host-UDP-only candidate filtering (`docs/WEBRTC-DEBUG.md`).
- Matter WebRTC provider filters bridge candidates down to the LAN host UDP `:8555` before sending them back to the hub.
- Default `data/go2rtc.yaml`: UDP4-only network filter, no bridge-side STUN/TURN.

### Planned

- ONVIF auto-discovery
- Push AV Stream Transport (`0x0555`) for SmartThings cloud recording plan (CMAF + TLS + time sync)
- Web UI warning when adding more than 4 cameras
- Automated tests
- First stable release (`1.0.0`)

---

## [0.3.0-beta] — 2026-06-08

Current beta milestone: streaming, camera management, documentation, and Web UI polish. Synced to GitHub.

### Added

- Cursor agent rule (`.cursor/rules/documentation.mdc`) requiring changelog updates for major changes and English-only documentation
- **Camera editing** in the Web UI (name, RTSP URL, codec) without removing/recreating the endpoint
- **REST API** `POST /api/cameras/:id` to update existing cameras
- **Live log panel** on the dashboard (`GET /api/logs`, 2 s polling)
- **Dynamic removal** of cameras on the Matter bridge (`endpoint.delete()`)
- **Metadata updates** on the bridge when editing the camera name (`BridgedDeviceBasicInformation`)
- **WebRTC pre-warm** on boot — starts ffmpeg transcode before the hub opens live view (avoids cold start > 5 s)
- **Periodic prune** of orphan go2rtc streams (default interval: 5 min)
- **`syncAllStreams()`** — re-registers all cameras and removes stale go2rtc entries
- **Per-camera locks** in `Go2RTCClient` to serialize heavy ffmpeg operations
- **WebRTC over WebSocket** when the hub sends TURN/STUN ICE servers (SmartThings)
- **ICE trickle** — Matter candidates mapped to SDP and back (`webrtcIce.ts`)
- **JPEG snapshots** via Camera AV Stream Management cluster (48 KB limit, max resolution 640×360)
- **Scaling documentation** in `docs/SCALING.md`
- Web UI quick-start wizard, external CSS/JS assets, info bar with version badge
- `src/config/version.ts` — version read from `package.json` (UI + Matter device metadata)

### Changed

- Project version set to **0.3.0-beta** (pre-1.0; not a stable release)
- All project documentation translated to English (`CHANGELOG.md`, `docs/SCALING.md`, `README.md`, deploy comments)
- `Go2RTCClient` rewritten: health check, 404 retry, ICE normalization, WS + HTTP exchange
- Startup order: cameras registered **before** `bridge.start()` (hub does not see an empty `partsList`)
- `docker-compose.yml`: go2rtc healthcheck with `depends_on: service_healthy`
- Web UI: card layout, inline actions (edit/cancel), troubleshooting log panel

### Fixed

- Orphan go2rtc streams after camera deletion
- Live view failure when ffmpeg had not yet brought up the `_webrtc` stream
- SmartThings hub ignoring `ice_servers` on HTTP JSON requests (go2rtc WebSocket API used instead)

---

## [0.2.0] — 2026-06-08

Initial go2rtc client improvements and connection resilience.

### Added

- `waitUntilReady()` — waits for go2rtc API after container restart (up to 60 attempts)
- `ensureStream()` — re-registers RTSP + `_webrtc` stream if missing
- `captureFrame()` — JPEG capture for Matter snapshots
- Automatic retry in `exchangeWebRtcOffer` when go2rtc returns 404
- Two streams per camera: direct RTSP + `{id}_webrtc` with H.264 transcode via ffmpeg

### Changed

- More detailed WebRTC flow logs (SDP size, ws/http mode, relay count)

---

## [0.1.0] — 2026-06-08

Matter Camera bridge MVP with Docker deployment and basic Web UI.

### Added

- **Matter Bridge** with `matter.js` 0.17 / Matter 1.5
  - Aggregator device type `0x0e`
  - Bridged Camera `0x0142` endpoints per RTSP camera
- **Matter clusters implemented**
  - `BridgedDeviceBasicInformation`
  - `CameraAvStreamManagement` (H.264 LiveView video, snapshot, audio stub)
  - `WebRtcTransportProvider` (`ProvideOffer`, `ProvideAnswer`, `ProvideIceCandidates`)
- **go2rtc integration** — PUT `/api/streams` registration, WebRTC POST `/api/webrtc`
- **Web UI** (Express + EJS)
  - Add/remove cameras
  - Matter pairing QR code and manual code
  - Fabric factory reset (`POST /api/reset`)
- **JSON storage** with lowdb (`data/cameras.json`)
- **Configuration** via `data/config.json` + env vars (`src/config/app.ts`)
- **Docker**
  - Multi-stage `Dockerfile` for Node app
  - `docker-compose.yml` with go2rtc + app on `network_mode: host`
- **Remote deploy** — `npm run deploy` (`scripts/deploy.sh`)
- **Matter patches** — `tlvPatch.ts`, relaxed WebRTC command validation (`webrtcCommandValidation.ts`)
- **README** with architecture, quick start, and SmartThings instructions

### Dependencies

- `@matter/main`, `@project-chip/matter.js` ^0.17.1
- `express` ^4.21, `ejs` ^3.1, `lowdb` ^7.0
- `alexxit/go2rtc` (container)

---

## [0.0.1] — 2026-06-05

### Added

- Initial GitHub repository with README stub ("Export Cameras to Matter")
- History merged with local project on 2026-06-08 (merge `origin/main`)

---

## Change types

| Type | Meaning |
|------|---------|
| **Added** | New feature |
| **Changed** | Change in existing behavior |
| **Deprecated** | Will be removed in a future version |
| **Removed** | Removed feature |
| **Fixed** | Bug fix |
| **Security** | Vulnerability fix |

---

## How to update this changelog

1. Group changes under **[Unreleased]** during development.
2. On release, move content to a new `[X.Y.Z] — YYYY-MM-DD` section.
3. Update `version` in `package.json` to stay in sync.
4. Use commit messages that map cleanly to changelog entries (e.g. `feat:`, `fix:`, `docs:`).

[Unreleased]: https://github.com/patricktd/MatterCameras/compare/v0.3.0-beta...HEAD
[0.3.0-beta]: https://github.com/patricktd/MatterCameras/compare/v0.2.0...v0.3.0-beta
[0.2.0]: https://github.com/patricktd/MatterCameras/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/patricktd/MatterCameras/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/patricktd/MatterCameras/releases/tag/v0.0.1
