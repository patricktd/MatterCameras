# Matter 1.5 camera features (SmartThings)

Bridge device type: **Camera `0x0142`** (bridged endpoint per RTSP camera).

## Current status

| Feature | Matter cluster | Bridge | SmartThings |
|---------|----------------|--------|-------------|
| Live view (iOS) | WebRTC Transport Provider | OK | OK — fast first attempt |
| Live view (Android) | WebRTC Transport Provider | OK | OK (2026-06-09; was signaling order, not DTLS) |
| Snapshot / card preview | Camera AV Stream Management | OK | OK |
| **Notification image** | `CaptureSnapshot` | OK | **OK** — JPEG appears in push notification |
| Motion → routines | **Zone Management** `0x0550` + **OccupancySensing** | RTSP frame-diff | Hub reprofile (`softwareVersion` 301) or 61.x beta drivers |
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

## Motion detection (Zone Management)

Matter 1.5 motion for routines uses the **Zone Management** cluster, not a vendor API.

### What the bridge exposes

- Cluster `0x0550` with features: `TwoDimensionalCartesianZone`, `UserDefined`, `PerZoneSensitivity`
- Manufacturer zone **#1** — full viewport (1920×1080 sensor), `ZoneUse.Motion`
- Default trigger: 10 s initial, 5 s augmentation, 120 s max, 30 s blind
- Events: `ZoneTriggered` (reason: Motion), `ZoneStopped`

### Motion source (generic RTSP)

`MotionDetectionService` polls a low-res JPEG from go2rtc every 2 s and compares consecutive frames (byte delta). No UniFi/ONVIF-specific code — works on any RTSP URL go2rtc can ingest.

When motion is detected, the bridge emits `ZoneTriggered` / `ZoneStopped` and updates **OccupancySensing**. SmartThings matter-switch maps occupancy to **motionSensor**, so routines use:

**IF → Device status → Camera → Motion detected**

(`ZoneTriggered` alone does not appear in the routine picker; it drives `zoneManagement` state on the hub.)

### Logs to watch

```
Motion detector start camera=cam-…
ZoneTriggered camera=cam-… zone=1
ZoneStopped camera=cam-… zone=1 reason=0
```

### After deploy

Existing paired cameras may need a **hub refresh** (or remove/re-add one camera) so SmartThings discovers the new Zone Management cluster on the endpoint.

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
