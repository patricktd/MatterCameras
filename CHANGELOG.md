# Changelog

All notable changes to **MatterCameras** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Repository: [github.com/patricktd/MatterCameras](https://github.com/patricktd/MatterCameras)

> **Project status:** pre-1.0 **beta**. Versions stay below `1.0.0` until the bridge is considered production-stable. `1.0.0` will mark the first stable release.

---

## System overview

**MatterCameras** is a bridge that exposes RTSP/ONVIF cameras as **Matter 1.5 Camera** devices (type `0x0142`) on any Matter 1.5–capable hub or controller. **SmartThings** is the primary reference platform today; other ecosystems are supported at the Matter protocol level as they add camera support.

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
| **Motion providers** | `src/motion/` | Pluggable per-camera motion backends (ONVIF, frame-diff; vendor plugins planned) |
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

See [docs/SCALING.md](docs/SCALING.md) for hardware recommendations, camera counts, and bottlenecks (ffmpeg, hub TURN, ~50 bridged devices per bridge on typical hubs).

---

## [Unreleased]

### Changed
- **Documentation** — README, install guide, Matter feature docs, scaling, and Web UI copy now describe Matter hubs generically; SmartThings remains documented as the reference platform where behavior is hub-specific.
- **Release versioning** — `npm run deploy` and `npm run quick-deploy` no longer auto-bump `package.json`. Use `npm run release` (patch), `release:minor`, or `release:major` when publishing to the community; update `CHANGELOG.md` and tag the release before deploy.
- **Mechanical PTZ exposure** — the Matter PTZ cluster is advertised only after a successful capability probe (`ptzCapable: true`). UniFi Protect cameras are excluded. Endpoints that no longer qualify are recreated without PTZ on bridge startup (hub may still need **Recycle Matter binding** on fixed cameras to refresh SmartThings).
- **Per-camera PTZ pan invert** — optional `ptzInvertPan` in `cameras.json` for SmartThings Android when pan is reversed vs iOS on the same camera.
- **Reolink spotlight probe** — bridged light endpoints now require an active WhiteLed hardware check (`SetWhiteLed` + `GetWhiteLed` confirmation). NVR channels without a spotlight no longer get a phantom SmartThings light. The Web UI **checkbox** is hidden automatically when the probe marks the camera as not capable (`reolinkLightCapable: false`).
- **Windows deploy (ARM64)** — `deploy.ps1` / `quick-deploy.ps1` sync with Git `tar` + OpenSSH instead of `rsync` (MSYS2 rsync segfaults under Git Bash on ARM Windows). SSH **multiplexing** (`ControlMaster`) prompts for the password once per run. `npm run deploy` routes to the PowerShell wrappers on `win32`.
- **Person detection vs camera motion** — the Matter camera endpoint always uses generic motion (`auto` → vendor native → ONVIF → frame diff). Person detection is only available via the optional **person presence sensor** checkbox (Reolink / UniFi Protect). Legacy `motionObjectType: person` on the camera record is migrated to the separate sensor on save.

### Fixed
- **Android `mptzSetPosition` tracking** — hub state no longer advances on preset no-ops; zoom preset slots (`zoom=11`) and encoded tilt (`50–90`) are stripped before delta calculation.
- **iOS/Android PTZ stops while holding** — SmartThings hub 61.x uses virtual-stick `mptzSetPosition` (±10); bridge now pulses on each repeat instead of no-op delta tracking.
- **Android PTZ pan inverted** — `mptzRelativeMove` pan is negated (Android mirrors pan vs iOS `mptzSetPosition` on hub 61.x); setPosition stick path unchanged for iOS.
- **Android PTZ inverted / preset jumps** — `mptzSetPosition` ignores preset jumps and zoom slots, uses dominant axis on diagonals.
- **iOS PTZ sluggish** — restored standard Reolink pulse duration (quick mode was too short).
- **NVR PTZ (E1 on Home Hub)** — `PtzCtrl` probe, pre-`Stop` on NVR hosts, retry without speed, log API rejection reason.
- **UniFi edit form** — Reolink spotlight and NVR channel fields no longer appear inside the person-sensor section when editing UniFi Protect cameras.
- **PTZ on non-PTZ cameras** — UniFi and other fixed cameras no longer inherit a PTZ cluster from the generic bridged camera device type.
- **SmartThings “saved as preset” toast** — the bridge does not update `mptzPosition` after moves; the Android app still shows the toast when it invokes `mptzSetPosition` (not fixable on the bridge).
- **Reolink WhiteLed probe regression** — passive `GetWhiteLed` checks no longer toggle the spotlight on startup, dashboard load, or person-sensor saves. Active hardware verification runs only when the bridged light is enabled. Reduces RTSP/WebRTC disruption on standalone Reolink cameras.
- **Live view first-attempt failures** — `ProvideOffer` now pre-warms the go2rtc transcode for every hub offer (not only compact/Android), reducing first-open timeouts.
- **Live view slow opens (regression)** — removed blocking ffmpeg pre-warm inside `ProvideOffer` (was adding ~8s before every hub offer after the 2-minute warm window). Pre-warm now runs in the background; startup + periodic refresh keep transcoders hot without delaying signaling.
- **Dashboard hang on save** — the home page no longer blocks on parallel Reolink WhiteLed hardware probes (same NVR host). Probes run in the background sequentially; camera save redirects immediately after settings persist.
- **Person presence / Reolink light checkboxes** — saving with the checkbox checked no longer drops the setting (Express submitted both hidden `false` and checkbox `true`; the parser now treats that as enabled).

### Added
- **Mechanical PTZ (beta)** — bridged cameras expose Matter `CameraAvSettingsUserLevelManagement` (`mptzSetPosition` / `mptzRelativeMove`). **Reolink** cameras use native `PtzCtrl` (recommended for TrackMix); other ONVIF PTZ cameras use continuous/relative ONVIF moves. Test without SmartThings: `POST /api/cameras/:id/ptz/left` (also `right`, `up`, `down`, `zoom-in`, `zoom-out`) and `GET /api/cameras/:id/ptz/probe`.
- **Person presence hold time** — Web UI option to choose how long the bridged person sensor stays active after each detection pulse (30s–5min, default **60s**). Applies to Reolink and UniFi Protect person sensors.
- **Reset ST binding** — dashboard action recreates a camera's Matter bridged endpoints with a new `uniqueId` so SmartThings can adopt the child again after a stale hub mapping (gray timeline / no live view while snapshots work on the server).
- **Separate bridged Reolink light** — Reolink cameras with WhiteLed support can expose an extra Matter **Dimmable Light** endpoint (`light-{cameraId}`) with on/off and brightness via `SetWhiteLed` / `GetWhiteLed` (maps to SmartThings `switch` + `switchLevel`).
- Git sync helpers for switching machines safely: `sync.sh`, `sync.ps1`, and `sync.cmd`.
- **Separate bridged person sensor** — supported Reolink and UniFi cameras can expose an extra Matter endpoint dedicated to person-only events, separate from the camera motion signal.
- Windows PowerShell helper scripts: `deploy.ps1`, `quick-deploy.ps1`, and `commit.ps1`.
- Windows root helper scripts: `deploy.cmd`, `quick-deploy.cmd`, and `commit.cmd`.
- Root helper scripts: `./deploy.sh`, `./quick-deploy.sh`, and `./commit.sh` for faster operator workflows from the repository root.
- **Permanent hub-adoption logs** — first `CaptureSnapshot`, `ProvideOffer`, ICE trickle, or session end on a bridged camera now emits `Hub adopted bridged camera=...` so operators can distinguish “bridge created the endpoint” from “SmartThings actually used it”.
- **Camera add providers (phase 2)** — saved **UniFi Protect controller** login in `data/settings.json` (Options + “Remember” checkbox); **Import all new** and **Link existing cameras** (match by name / RTSP alias); **Tapo / Sonoff** plugin (ONVIF direct on port 2020).
- **Camera add providers** — plugin-style add flow in the Web UI: tabs for **UniFi Protect**, **Reolink**, **ONVIF**, and **Manual RTSP**. `GET /api/camera-providers`, `POST …/discover`, `POST …/resolve`. UniFi lists adopted cameras from the controller and fills `rtsps://…:7441/{alias}` + `protectHost` / `protectCameraId` automatically. Docs: `docs/CAMERA-PROVIDERS.md`. — ONVIF hardening: namespace strip, 30s hold debounce (`OnvifMotionDebouncer`), expanded topic markers (Reolink AI, Visitor, Tapo CellMotion), `suggestMotionProvider` on `/api/onvif/resolve`, Web UI **Auto** motion mode (`views/partials/motion-options.ejs`).
- **Motion providers phase 3a** — `ReolinkMotionProvider` via native `api.cgi` (`GetMdState` + `GetAiState`); auto-select when `manufacturer` is Reolink.
- **Motion providers phase 3b** — `UnifiProtectMotionProvider` via `unifi-protect` npm (WebSocket per controller); requires `protectHost` + `protectCameraId` in camera Advanced options. **Requires `npm run deploy`** for new dependency.
- **Motion provider registry (phase 1)** — pluggable `MotionProvider` architecture (`src/motion/`): registry, fallback chains, docs `docs/MOTION-PROVIDERS.md`. Tests: `npm test`.
- **Duplicate camera** — in the edit form, creates a copy with the same stream settings after prompting for a new name.
- **ONVIF scan** — discovered devices already in the camera list are hidden from scan results.
- **Dashboard camera preview** — live JPEG thumbnail per camera via `GET /api/cameras/:id/snapshot`; online/offline badge refreshed every 30s (staggered fetches to avoid go2rtc contention).
- **ONVIF WS-Discovery** — `POST /api/onvif/discover` scans the LAN (UDP 3702); `POST /api/onvif/resolve` fetches RTSP URL and device info. Web UI scan panel in Add Camera form.
- **ONVIF motion detection** (optional per camera) — native `MotionAlarm` / `CellMotionDetector` events via ONVIF PullPoint; falls back to frame-diff on failure. Inspired by [matter-onvif-bridge](https://github.com/iamjairo/matter-onvif-bridge).
- **RTSP credential redaction** in logs and Web UI display (`redactRtspUrl`); passwords never shown in the camera list.
- **SmartThings 4-camera preview warning** in the Web UI when more than four cameras are bridged.
- `GET /api/diagnostics/snapshots` — per-camera go2rtc snapshot health check (hub-independent).
- `docs/INSTALL.md` — step-by-step tester guide (pairing, cameras, troubleshooting).
- `docs/DEPLOY.md` — production rsync deploy (moved out of README).
- `data/config.json.example` and `data/go2rtc.yaml.example` — host-agnostic templates for new installs.
- Web UI **Options** panel and bridge restart action.
- Matter 1.5 **Zone Management** (`0x0550`) with full-viewport motion zone and `ZoneTriggered` / `ZoneStopped` events for SmartThings routines.
- **OccupancySensing** cluster on bridged cameras for SmartThings routine picker (`motionSensor` capability after hub reprofile).
- Generic **RTSP motion detection** via go2rtc JPEG frame comparison (`MotionDetectionService`); no vendor-specific APIs.
- `docs/MATTER-CAMERA.md` — snapshots in notifications, motion routines, and cloud recording gap analysis.
- `matterSoftwareVersion` (301) on bridged cameras to trigger SmartThings camera reprofile after new clusters.
- Docker bind-mount `./dist`, `./views`, and `./public` (read-only) so `quick-deploy.sh` updates running container without image rebuild.
- SmartThings **live view (WebRTC)** on **iOS and Android** — operator confirmed 2026-06-09; **audio (Opus)** on both platforms (see `docs/WEBRTC-DEBUG.md`).
- Hub offer SDP diagnostics (`setup`, fingerprint, candidate count) on each `ProvideOffer`.
- Android/compact-hub path: keep full hub ICE in go2rtc offer copy, prewarm before exchange, recycle on hub retry; inline bridge ICE candidates in answer SDP. Compact detection uses AND (small SDP + few candidates) so iOS is unaffected.
- `scripts/watch-webrtc-logs.sh` — filtered tail of Matter + go2rtc logs for live-view test sessions.
- **ImageControl (flip / rotation):** SmartThings `imageFlipHorizontal`, `imageFlipVertical`, and `imageRotation` rebuild go2rtc ffmpeg sources for live view, snapshots, and motion; identity defaults keep raw-RTSP snapshots (see `.cursor/rules/image-control.mdc`).

### Changed
- **Reolink add flow** — newly added Reolink cameras now default to the **sub-stream** RTSP URL (`Preview_XX_sub` / `h264Preview_XX_sub`) for faster SmartThings live view (native H.264, no main-stream H.265 transcode).
- Web UI restart button now shows **Restart Bridge** normally and **Restart Required** (light red) after camera roster changes; clicking restart shows a waiting page and polls until the bridge is back online.
- Person-only signaling wording now uses **presence semantics** in the Web UI and bridged endpoint labels (no storage/schema break; existing `personSensorEnabled` remains supported for compatibility).
- Adding cameras no longer restarts the bridge automatically; the Web UI now labels the action as **Restart Required** so roster reload is explicit.
- **Reolink add flow hardening** — discovery now uses `GetDevInfo`, `GetNetPort`, `GetChannelstatus`, `GetChnTypeInfo`, `GetEnc`, and `GetRtspUrl` instead of a fixed `:554/h264Preview_XX_main` assumption; direct dual-lens cameras stay as a single addable device, while NVR / Home Hub discovery prefers active channels with UID-based dedupe.
- `cameras.json` now persists additional Reolink connection metadata (`reolinkHost`, `reolinkHttpPort`, `reolinkUseHttps`, `reolinkRtspPort`, `reolinkProtocol`, `reolinkStream`, `reolinkDeviceUid`, `reolinkIsNvr`) so native motion no longer depends solely on parsing RTSP URLs.
- Web UI motion defaults to **`auto`** for new cameras; ONVIF scan suggests provider from manufacturer/model.
- Web UI motion form shows **only relevant fields** per motion source (UniFi / Reolink / ONVIF / frame diff).
- `cameras.json` supports `manufacturer`, `model`, `reolinkChannel`, `protectHost`, `protectCameraId`.
- ONVIF motion uses **30s hold debounce** (improves Tapo/Sonoff CellMotion reliability).
- **Reverted endpoint slot pool** — pre-registered `cam-slot-XX` placeholders caused dozens of useless camera devices in SmartThings; bridge now exposes only real cameras and purges legacy slots on startup.
- Adding a camera while paired keeps the bridge online; use **Restart Required** manually when a bridge reload is desired.
- `quick-deploy.sh` and `deploy.sh` always run `docker compose restart app` so `/api/version` matches synced `package.json`.
- `deploy.sh` now rsyncs `dist/` to the host (required with `./dist` bind-mount in `docker-compose.yml`).
- **Privacy / deploy safety** — removed committed `data/config.json` and `data/go2rtc.yaml`; gitignore runtime config; deploy scripts never rsync `cameras.json`, `config.json`, `go2rtc.yaml`, or `matter-storage/`.
- Matter `prepareHubOfferForGo2rtc`: LAN-only hub candidates + internal `ice-lite` hint so the bridge can nominate ICE pairs.
- go2rtc WebRTC source `ffmpeg:…#video=h264#audio=opus` for Matter/SmartThings A/V.
- Camera add/remove while paired uses runtime Matter endpoint updates + `PartsList` / `softwareVersion` announce; auto-restart on add when commissioned. See `docs/MATTER-BRIDGE.md`.
- Motion detection: less sensitive frame-diff (hysteresis, debounce, changed-pixel ratio) and default zone sensitivity 3; reduces false triggers on outdoor cameras.

### Fixed
- Web UI **New pairing code** now rotates the Matter commissioning discriminator and updates the QR/manual code (previously **Refresh QR** only reloaded the page with the same fixed codes).
- Startup crash loop after removing the last SmartThings bridge: when Matter startup detects stale fabric references (e.g., `Fabric index ... does not exist` / `fabric-not-found`), the app now clears only Matter storage and exits cleanly so Docker restarts in **Ready to Pair** mode automatically.
- **UniFi Protect bulk import stability** — `POST /api/camera-providers/unifi-protect/import` now reuses a single Protect login/bootstrap for the whole batch instead of logging in once per camera; production imports had been stopping after only a few cameras when repeated controller logins began failing.
- **Camera roster persistence** — `StorageService` now clones returned camera objects and reloads lowdb before each write, preventing stale in-memory state from overwriting `data/cameras.json` with a partial roster during production imports.
- **ONVIF motion PullPoint** — pass `path` and `preserveAddress` from `onvifUrl`; connect before subscribing; share one PullPoint per NVR endpoint (fixes `SOAP-ENV:Sender` when multiple cameras use the same host); broaden motion topic parsing.
- **Version stuck after quick-deploy** — container was not restarted when already running; `/api/version` showed an older bump until manual `docker compose restart app`.
- **Missing `onvif` in Docker image** — adding the dependency requires `npm run deploy` (image rebuild), not quick-deploy alone.
- **Motion detection boot race:** motion polling no longer starts inside `addCamera()` before go2rtc streams exist. The second `startCamera` call was a no-op once the detector was already created, causing startup `no go2rtc stream` warnings and unreliable first polls.
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

### Planned

- ONVIF periodic background rescan (auto mode like matter-onvif-bridge)
- Push AV Stream Transport (`0x0555`) for SmartThings cloud recording plan (CMAF + TLS + time sync)
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
