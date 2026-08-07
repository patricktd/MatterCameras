# Changelog

All notable changes to **Matter Cameras Bridge** are documented here ([Keep a Changelog](https://keepachangelog.com/), [SemVer](https://semver.org/)).

---

## [Unreleased]

---

## [0.5.4-beta] — 2026-08-07

### Fixed

- The isolated update helper explicitly installs development build tools even though the app image runs with `NODE_ENV=production`.

---

## [0.5.3-beta] — 2026-08-07

### Fixed

- One-click updates no longer fail when Git rejects the container-mounted checkout as having dubious ownership.
- Docker Compose now runs from an isolated helper at the checkout's real host path, preserving the existing runtime data mounts during updates.

---

## [0.5.2-beta] — 2026-08-07

### Fixed

- Update checks refresh within five minutes instead of retaining stale GitHub release data for one hour.
- Hidden update controls no longer appear without an actionable update.

---

## [0.5.1-beta] — 2026-08-07

### Added

- Optional **pre-built image** install path via GHCR (`docker-compose.cli.yml`, `docker-compose.casaos.yml`) alongside the existing build-from-source flow.
- GitHub Actions: `ci` (test/build on push/PR) and `publish-images` (push to GHCR on `v*` tags — does not take over local release/versioning). App image is **amd64** for now; go2rtc is amd64+arm64.
- `GITHUB_REPO` environment variable to choose which repository the Web UI polls for update notifications (default remains upstream).
- Web UI branding: simple **MC** logo (camera → hub) in the header/favicon, plus Material Symbols icons self-hosted under `public/fonts/` (no Google Fonts CDN).

### Changed

- Upgraded **matter.js** (`@matter/*`) from 0.17.7 to **0.17.9** (subscription/session reliability + MRP fixes).
- Bridge advertises explicit Matter 1.6 **CapabilityMinima** sized for a multi-camera aggregator (higher read/subscribe path counts).
- `SnapshotStreamAllocate` rejects non-JPEG codecs with `ConstraintError` (HEIC deferred until an encoder exists).
- Matter `softwareVersion` base bumped to **310** so hubs re-interview after the SDK/capability change.
- Upgraded **matter.js** (`@matter/*`) from 0.17.3 to **0.17.7** (Matter 1.6 model; no breaking device API changes).
- Structure announces now bump Matter **`configurationVersion`** (root + bridged) alongside `softwareVersion` / `PartsList`.
- OccupancySensing enables the **OccupancyEvent** feature so hubs receive `OccupancyChanged` on motion state flips.
- Cameras advertise **LiveView only** for stream usages (Recording deferred until Push AV Stream Transport).
- Web UI shows **Update now** only when one-click self-update is available (git clone + Docker path); image-only installs see the release link / pull instructions instead.
- Dashboard contrast and light motion polish (wizard chips, card hover, focus rings); system font stack instead of remote Inter.

### Fixed

- Root **BasicInformation** now sets `hardwareVersion` / `softwareVersion` at `ServerNode.create` (seeded from the camera roster), preventing SmartThings from seeing a transient `softwareVersion=0` and showing a persistent firmware-update indicator.
- New installations use the project-specific Matter Product ID `0xCA42` instead of matter.js's generic test value `0x8000`, preventing unrelated SmartThings Edge drivers from claiming the bridge by manufacturer fingerprint. Existing pairings remain intact; `MATTER_PRODUCT_ID` remains configurable.
- Creating, duplicating, or bulk-importing a camera no longer collides on `Date.now()` IDs (uses a short UUID); double-clicks are ignored while Add Camera / Duplicate submits.

---

## [0.5.0-beta] — 2026-07-31

### Added

- **Multi-fabric (multi-admin) support** — the bridge can be paired with several Matter ecosystems at once (SmartThings + Apple Home + Google Home, …):
  - **Pair another hub** on the dashboard opens a 15-minute Enhanced Commissioning window with a fresh one-time QR / manual pairing code.
  - **Connected hubs list** shows every fabric with its controller-set label (or known ecosystem name from the vendor ID) via `GET /api/fabrics`.
  - **Remove fabric** per hub (`DELETE /api/fabrics/:fabricIndex`) — the other hubs keep working; removing the last fabric returns the bridge to pairing mode.

### Fixed

- Stale-fabric crash recovery no longer wipes all Matter storage (and every other hub's pairing) when a fabric-not-found error follows an intentional fabric removal.
- Bridged device `serialNumber` truncated to 32 characters (Matter Basic Information limit).

---

## [0.4.2-beta] — 2026-06-29

### Changed

- One-click **Update now** is enabled by default in Docker installs (no separate compose overlay or “How to update” link).
- `setup.sh` requires a git clone so self-update works out of the box.

### Fixed

- Web UI self-update failed silently when the app image lacked `bash`; update output is logged to `data/self-update.log`.
- GitHub update check falls back to version tags when no formal GitHub Release is published.

---

## [0.4.1-beta] — 2026-06-29

### Fixed

- GitHub release check now includes prerelease tags (e.g. `0.4.0-beta`); `/releases/latest` ignored them before.

---

## [0.4.0-beta] — 2026-06-29

First public beta under the **Matter Cameras Bridge** name.

### Added

- **Software update notifications** — Web UI checks [GitHub Releases](https://github.com/patricktd/MatterCameras/releases) and shows a banner when a newer version is available.
- **One-click self-update (optional)** — `docker-compose.update.yml` + `scripts/self-update.sh` (git checkout tag, `npm ci`, rebuild containers); `data/` preserved.
- **Mechanical PTZ (beta)** — Matter `CameraAvSettingsUserLevelManagement`; Reolink `PtzCtrl` or ONVIF moves; `POST /api/cameras/:id/ptz/*`, `GET …/ptz/probe`.
- **Person presence hold time** — configurable 30s–5min (default 60s) for Reolink / UniFi person sensors.
- **Reset ST binding** — recreates bridged endpoints with new `uniqueId` for stale SmartThings mappings.
- **Separate bridged Reolink light** — optional Matter Dimmable Light via WhiteLed API.
- **Separate bridged person sensor** — person-only events on a dedicated endpoint (Reolink / UniFi).
- **Permanent hub-adoption logs** — `Hub adopted bridged camera=…` on first hub use per endpoint.
- **Camera add providers** — UniFi Protect, Reolink, ONVIF, Tapo/Sonoff, Manual RTSP (`docs/CAMERA-PROVIDERS.md`).
- **UniFi Protect** — saved controller login, bulk import, link existing cameras.
- **Motion providers** — registry + Reolink native, UniFi Protect WebSocket, ONVIF PullPoint, frame-diff (`docs/MOTION-PROVIDERS.md`).
- **Duplicate camera**, **dashboard JPEG preview**, ONVIF WS-Discovery, RTSP redaction, SmartThings 4-camera warning.
- **Zone Management** + **OccupancySensing** for hub motion routines.
- **ImageControl** (flip / rotation) via go2rtc ffmpeg.

### Changed

- **Display name** — **Matter Cameras Bridge**; CSA trademark disclaimer in Web UI; hub `productName` updated.
- **Install docs** — Linux/macOS host, SmartThings reference platform, Web UI security, camera provider matrix.
- **Release versioning** — version bumped only via `npm run release` (not on every code sync).
- **Mechanical PTZ exposure** — cluster only after successful probe; UniFi excluded.
- **Per-camera PTZ pan invert** — `ptzInvertPan` for SmartThings Android.
- **Reolink spotlight probe** — active WhiteLed check; no phantom light endpoints.
- **Person vs camera motion** — person detection on optional presence sensor only.
- **Reolink add flow** — sub-stream default, richer discovery API, persisted connection metadata.
- **Web UI restart** — **Restart Required** after roster changes; waiting page with poll.
- **Privacy** — runtime `data/config.json`, `go2rtc.yaml` gitignored; templates in `data/*.example`.
- Matter hubs described generically in docs; SmartThings where behavior is hub-specific.

### Fixed

- Android / iOS PTZ (`mptzSetPosition`, pan invert, preset jumps, hold-to-move).
- NVR PTZ on Reolink Home Hub; UniFi edit form field bleed; PTZ on non-PTZ cameras.
- Reolink WhiteLed probe regression (no spotlight toggle on passive checks).
- Live view first-attempt / slow opens (pre-warm strategy).
- Dashboard hang on parallel Reolink probes; person/light checkbox save parsing.
- UniFi bulk import (single Protect login per batch); roster persistence (`lowdb` stale writes).
- ONVIF motion PullPoint (shared subscription per NVR, topic parsing).
- Motion boot race, factory reset storage cleanup, pairing code rotation.
- Startup crash after stale Matter fabric; ICE / WebRTC signaling order for SmartThings.

### Removed

- Maintainer-only deploy/sync/commit tooling from the public repository (private copies on operator NAS).

---

## [0.3.0-beta] — 2026-06-08

### Added

- Camera editing in Web UI; `POST /api/cameras/:id`; live log panel.
- Dynamic camera removal; metadata updates on rename.
- WebRTC pre-warm, periodic go2rtc prune, per-camera locks, ICE trickle.
- JPEG snapshots; `docs/SCALING.md`, `docs/INSTALL.md`; Web UI wizard and version badge.
- SmartThings live view WebRTC (iOS + Android); Zone Management + OccupancySensing.
- ONVIF motion (optional); RTSP frame-diff motion; `docs/MATTER-CAMERA.md`.

### Changed

- Documentation in English; `Go2RTCClient` rewrite; startup registers cameras before `bridge.start()`.
- Docker go2rtc healthcheck; Matter ICE / go2rtc ffmpeg tuning for SmartThings.

### Fixed

- Orphan go2rtc streams; live view cold start; hub `ice_servers` over WebSocket.
- Motion routines via OccupancySensing; deferred WebRTC answer (Matter 1.5 §11.5.7.4).
- Version display after container restart; ONVIF dependency in Docker image.

---

## [0.2.0] — 2026-06-08

### Added

- go2rtc `waitUntilReady`, `ensureStream`, `captureFrame`; WebRTC retry on 404.
- Dual streams per camera (RTSP + H.264 `_webrtc` transcode).

### Changed

- Expanded WebRTC diagnostic logging.

---

## [0.1.0] — 2026-06-08

### Added

- Matter 1.5 bridge (`matter.js` 0.17): Aggregator + bridged Camera `0x0142`.
- go2rtc integration; Web UI (pairing QR, add/remove cameras, factory reset).
- `data/cameras.json` storage; Docker Compose host networking.
- `scripts/setup.sh` for first-time install.

---

## [0.0.1] — 2026-06-05

### Added

- Initial repository and README stub.

---

[Unreleased]: https://github.com/patricktd/MatterCameras/compare/v0.5.4-beta...HEAD
[0.5.4-beta]: https://github.com/patricktd/MatterCameras/compare/v0.5.3-beta...v0.5.4-beta
[0.5.3-beta]: https://github.com/patricktd/MatterCameras/compare/v0.5.2-beta...v0.5.3-beta
[0.5.2-beta]: https://github.com/patricktd/MatterCameras/compare/v0.5.1-beta...v0.5.2-beta
[0.5.1-beta]: https://github.com/patricktd/MatterCameras/compare/v0.5.0-beta...v0.5.1-beta
[0.5.0-beta]: https://github.com/patricktd/MatterCameras/compare/v0.4.2-beta...v0.5.0-beta
[0.4.2-beta]: https://github.com/patricktd/MatterCameras/releases/tag/v0.4.2-beta
[0.4.1-beta]: https://github.com/patricktd/MatterCameras/releases/tag/v0.4.1-beta
[0.4.0-beta]: https://github.com/patricktd/MatterCameras/releases/tag/v0.4.0-beta
[0.3.0-beta]: https://github.com/patricktd/MatterCameras/compare/v0.2.0...v0.3.0-beta
[0.2.0]: https://github.com/patricktd/MatterCameras/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/patricktd/MatterCameras/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/patricktd/MatterCameras/releases/tag/v0.0.1
