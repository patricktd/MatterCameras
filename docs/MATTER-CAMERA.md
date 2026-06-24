# Matter 1.5 camera features (SmartThings)

Bridge device type: **Camera `0x0142`** (bridged endpoint per RTSP camera).

## Current status

| Feature | Matter cluster | Bridge | SmartThings |
|---------|----------------|--------|-------------|
| Live view (iOS) | WebRTC Transport Provider | OK | OK — fast first attempt |
| Live view (Android) | WebRTC Transport Provider | OK | OK (2026-06-09; was signaling order, not DTLS) |
| Snapshot / card preview | Camera AV Stream Management | OK | OK |
| Image flip / rotation | ImageControl (AV cluster) | OK | OK — set in device settings; re-open live view after change |
| **Notification image** | `CaptureSnapshot` | OK | **OK** — JPEG appears in push notification |
| Motion → routines | **Zone Management** `0x0550` + **OccupancySensing** | frame-diff or ONVIF | Hub reprofile (`softwareVersion` 301+) or 61.x drivers |
| ONVIF discovery | REST + Web UI | WS-Discovery UDP 3702 | Requires Docker host networking |
| Cloud recording plan | **Push AV Stream Transport** `0x0555` | **Not implemented** | UI shows plan; **no clips upload** |

---

## Snapshots and notifications

SmartThings requests `CaptureSnapshot` over Matter. The bridge grabs a JPEG from go2rtc (`/api/frame.jpeg?width=640`) preserving aspect ratio and returns it in the Matter response.

When motion or camera events fire, SmartThings can attach that snapshot to the **push notification** — confirmed working in production (2026-06-08). Delivery is **hub-driven** (not every `ZoneTriggered` gets a `CaptureSnapshot` request). Native camera motion alerts include images; custom routine “send notification” actions are usually text-only.

Logs:

```
CaptureSnapshot camera=cam-… maxWidth=640 (aspect preserved)
CaptureSnapshot done camera=cam-… 640x853 … bytes
```

---

## Image orientation (ImageControl)

SmartThings exposes **flip horizontal**, **flip vertical**, and **rotation** (0–359°) under camera device settings. The hub writes Matter attributes on the bridged endpoint; the bridge rebuilds go2rtc ffmpeg sources with an `-vf` filter chain (`transpose`, `hflip`, `vflip`, or `rotate=` for non-90° steps).

Applies to **live view**, **card snapshots**, and **motion frame sampling** so all paths stay consistent.

**After changing orientation in the app:** close and reopen live view (WebRTC session caches the old ffmpeg graph until the next `ProvideOffer`).

**Defaults (no user change):** snapshot path stays **direct RTSP** for performance; only the WebRTC transcode stream uses ffmpeg — same as before ImageControl.

Logs:

```
ImageControl applied camera=cam-… flipH=true flipV=false rot=0
```

---

Matter 1.5 motion for routines uses the **Zone Management** cluster, not a vendor API.

### What the bridge exposes

- Cluster `0x0550` with features: `TwoDimensionalCartesianZone`, `UserDefined`, `PerZoneSensitivity`
- Manufacturer zone **#1** — full viewport (1920×1080 sensor), `ZoneUse.Motion`
- Default trigger: 10 s initial, 5 s augmentation, 120 s max, 30 s blind
- Events: `ZoneTriggered` (reason: Motion), `ZoneStopped`

### Motion source (generic RTSP — default)

`motionSource: frame-diff` or unset. Provider `FrameDiffMotionProvider` polls JPEG from go2rtc (~3 s).

### Motion source (auto — recommended)

`motionSource: auto` tries, in order: **UniFi Protect** → **Reolink native** → **ONVIF** → **frame-diff**.
Configure vendor fields in Web UI Advanced options. ONVIF scan pre-fills `manufacturer` and suggests auto.

### Motion source (ONVIF)

`motionSource: onvif` or auto fallback. `OnvifMotionProvider` with **30s hold debounce** (Tapo/Sonoff CellMotion).
Optional `onvifUrl` (Tapo often port **2020**).

### Motion source (Reolink / UniFi)

- **Reolink:** `reolink-native` or auto when `manufacturer: Reolink`; optional `reolinkChannel`.
- **UniFi:** `unifi-protect` or auto when `protectHost` + `protectCameraId` set.

**Architecture:** [MOTION-PROVIDERS.md](./MOTION-PROVIDERS.md).

Inspired by [matter-onvif-bridge](https://github.com/iamjairo/matter-onvif-bridge).

When motion is detected, the bridge emits `ZoneTriggered` / `ZoneStopped` and updates **OccupancySensing**. SmartThings matter-switch maps occupancy to **motionSensor**, so routines use:

**IF → Device status → Camera → Motion detected**

(`ZoneTriggered` alone does not appear in the routine picker; it drives `zoneManagement` state on the hub.)

### Logs to watch

```
Frame diff motion watching camera=cam-…    # frame-diff provider
ONVIF events motion watching camera=cam-…  # onvif provider
ONVIF motion failed … falling back to frame-diff
ZoneTriggered camera=cam-… zone=1
ZoneStopped camera=cam-… zone=1 reason=0
```

### After deploy

Existing paired cameras may need a **hub refresh** (or remove/re-add one camera) so SmartThings discovers the new Zone Management cluster on the endpoint.

---

## ONVIF WS-Discovery (add cameras)

Web UI: **Add Camera** → **ONVIF network scan** → enter username/password → **Use** on a discovered device. Fills name, RTSP URL, and ONVIF URL; sets motion to ONVIF when the camera reports motion events.

REST API (same LAN as the bridge host; requires UDP 3702 multicast — works with Docker `network_mode: host`):

```bash
# Scan (~5 s)
curl -s -X POST http://<host>:3202/api/onvif/discover \
  -H 'Content-Type: application/json' -d '{"timeoutMs":5000}'

# Resolve RTSP URL for one device
curl -s -X POST http://<host>:3202/api/onvif/resolve \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"192.168.1.10","port":80,"username":"admin","password":"secret"}'
```

**Files:** `src/onvif/discovery.ts`, `src/onvif/connectCamera.ts`

---

## Cloud recording plan (why it does not record)

SmartThings offers a subscription plan to select up to **4 cameras** for cloud recording. The UI appears because the device type is **Matter Camera**, but clips are uploaded via a different path than live view:

### Matter path for recording

1. Hub calls `VideoStreamAllocate` / `AudioStreamAllocate` with `StreamUsage.Recording`
2. Hub calls **`AllocatePushTransport`** on **Push AV Stream Transport** (`0x0555`)
3. Bridge uploads **CMAF** segments over **HTTPS + TLS client cert** when motion/continuous trigger fires
4. Requires **TLS Client Management** + **Time Synchronization** on the bridge

### What this bridge implements today

| Step | Status |
|------|--------|
| `supportedStreamUsages` includes `Recording` | Yes (advertised) |
| `VideoStreamAllocate(Recording)` | Logs + allocates stream id 2 |
| **Push AV Stream Transport cluster** | **Missing** |
| CMAF encoder + HTTPS upload | **Missing** |
| TLS Client Management | **Missing** |

### Server log analysis (2026-06-08)

Over 7 days of production logs:

- **`AllocatePushTransport`**: zero invocations
- **`streamUsage: 1` (Recording)** in WebRTC `ProvideOffer`: zero
- Only **`streamUsage: 3` (LiveView)** for WebRTC

Conclusion: the hub never started a push transport with this bridge. The recording plan UI is shown at the **SmartThings account/plan** level, but without Push AV Stream the bridge cannot upload clips. Implementing recording is a **large follow-up** (CMAF pipeline + TLS + time sync), not a small fix.

When the hub eventually requests recording streams, logs will show:

```
VideoStreamAllocate Recording camera=cam-… (Push AV Stream Transport not implemented — …)
```

---

## Routines cheat sheet

| Trigger (IF) | Matter basis | Available now |
|--------------|--------------|---------------|
| Motion detected | `ZoneTriggered` | After this deploy + hub refresh |
| Manual / time | — | Standard SmartThings |
| Live view open | — | Not a Matter routine trigger |

| Action (THEN) | Available now |
|---------------|---------------|
| Send notification (with snapshot) | OK |
| Turn on lights / scene | OK |
| Start recording clip | **No** — needs Push AV Stream |

---

## Matter 1.5.1 (not available yet)

CSA maintenance release adds multi-stream delivery, HEIC snapshots, and HLS/DASH CMAF upload. Requires Matter SDK 1.5.1, SmartThings hub support, and bridge implementation (especially **Push AV Stream** for recording). See [matter-smarthome.de overview](https://matter-smarthome.de/en/development/matter-1-5-1-camera-refinements-and-more-flexibility/).

---

## Related files

| File | Role |
|------|------|
| `docs/AGENT-CONTEXT.md` | Full agent handoff — start here |
| `src/matter/behaviors/MatterZoneManagementServer.ts` | Zone events for routines |
| `src/matter/behaviors/MatterOccupancySensingServer.ts` | Routine picker `occupied` state |
| `src/streaming/rtspMotionDetector.ts` | Generic RTSP motion |
| `src/streaming/MotionDetectionService.ts` | Per-camera polling |
| `src/matter/devices/zoneManagementDefaults.ts` | Default full-frame zone |
| `docs/WEBRTC-DEBUG.md` | Live view ICE/DTLS debugging |
