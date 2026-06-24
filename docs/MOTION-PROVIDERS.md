# Motion providers

Architecture for per-camera motion detection backends. Inspired by [Scrypted](https://github.com/koush/scrypted)
plugins, implemented **in-process** (no RPC) for the Matter bridge.

**Research (brand matrix, Scrypted references):** [MOTION-PROVIDERS-PHASE0.md](./MOTION-PROVIDERS-PHASE0.md)

---

## Overview

```
Camera (cameras.json)
    motionSource: auto | frame-diff | onvif | reolink-native | unifi-protect
         │
         ▼
MotionDetectionService
         │
         ▼
MotionProviderRegistry.startCamera()
         │
         ├── resolveMotionProviderChain()  → ordered provider ids
         ├── provider.canHandle(camera)
         ├── provider.start()  ──on failure──► next in chain
         │
         ▼
MotionCallbacks → streamContext → Matter Zone Management + OccupancySensing
```

---

## Built-in providers

| Id | Class | Priority | Transport | Shared connection |
|----|-------|----------|-----------|-------------------|
| `unifi-protect` | `UnifiProtectMotionProvider` | 10 | Protect API + WebSocket | 1 WS per controller (`protectHub`) |
| `reolink-native` | `ReolinkMotionProvider` | 20 | HTTP `api.cgi` poll 1s | per camera |
| `onvif` | `OnvifMotionProvider` | 30 | ONVIF WSPullPoint | 1 PullPoint per `host:port:path` |
| `frame-diff` | `FrameDiffMotionProvider` | 100 | go2rtc JPEG poll | per camera |

### Provider chains

| `motionSource` | Chain |
|----------------|-------|
| `auto` (recommended for new cameras) | `unifi-protect` → `reolink-native` → `onvif` → `frame-diff` |
| `unifi-protect` | `unifi-protect` → `onvif` → `frame-diff` |
| `reolink-native` | `reolink-native` → `onvif` → `frame-diff` |
| `onvif` | `onvif` → `frame-diff` |
| *(unset)* / `frame-diff` | `frame-diff` |

Each step runs only when `canHandle()` matches (e.g. Reolink needs `manufacturer: Reolink` or explicit source; UniFi needs `protectHost` + `protectCameraId`).

---

## ONVIF hardening (phase 2)

| Feature | File |
|---------|------|
| Namespace strip on topics | `src/onvif/stripNamespaces.ts` |
| 30s hold debounce (CellMotion, MotionStop) | `src/onvif/motionDebounce.ts`, `motionSubscriptionHub.ts` |
| Expanded topic markers (Reolink AI, Visitor, Tapo) | `src/onvif/motionTopics.ts` |
| Scrypted-style event kinds (`pulse` / `start` / `stop`) | `src/onvif/parseOnvifMotionEvent.ts` |
| Brand → provider suggestion on ONVIF resolve | `src/motion/suggestMotionProvider.ts` |

Env tuning: `MOTION_ONVIF_HOLD_MS` (default 30000).

---

## Reolink native (phase 3a)

- Polls `GetMdState` + `GetAiState` on `http://{host}/api.cgi`
- Auto-selected when `manufacturer` contains `Reolink` and `motionSource: auto`
- Optional `reolinkChannel` for NVR channels (default 0)
- Env: `MOTION_REOLINK_POLL_MS`, `MOTION_REOLINK_HOLD_MS`

---

## UniFi Protect (phase 3b)

- Requires `protectHost` (controller IP) and `protectCameraId` (24-char id from Protect)
- Uses [`unifi-protect`](https://github.com/hjdhjd/unifi-protect) npm — **requires `npm run deploy`** (Docker image rebuild)
- One WebSocket per Protect controller; routes `motion` events and `isMotionDetected` updates
- Env: `MOTION_UNIFI_HOLD_MS` (default 25000)
- **Node.js ≥ 22** recommended (`unifi-protect` engine requirement)

---

## Source layout

| Path | Role |
|------|------|
| `src/motion/types.ts` | Interfaces and ids |
| `src/motion/resolveMotionProvider.ts` | Chain resolution |
| `src/motion/suggestMotionProvider.ts` | ONVIF resolve heuristics |
| `src/motion/parseMotionForm.ts` | Web UI / API parsing |
| `src/motion/MotionProviderRegistry.ts` | Registry + fallback start |
| `src/motion/providers/*` | Provider implementations |
| `src/streaming/MotionDetectionService.ts` | Orchestrator |
| `views/partials/motion-options.ejs` | Advanced motion form |

---

## Configuration (`data/cameras.json`)

```json
{
  "id": "cam-123",
  "name": "Driveway",
  "rtspUrl": "rtsp://user:pass@192.168.1.50:554/stream",
  "motionSource": "auto",
  "manufacturer": "Reolink",
  "onvifUrl": "http://192.168.1.50:80/onvif/device_service",
  "reolinkChannel": 0,
  "protectHost": "192.168.1.1",
  "protectCameraId": "64b2e59f0106eb03e4001210"
}
```

Web UI → **Advanced options** sets all fields. ONVIF scan auto-fills `manufacturer`, `model`, and suggests `motionSource: auto`.

---

## API: ONVIF resolve

`POST /api/onvif/resolve` now returns:

```json
{
  "suggestedMotionSource": "auto",
  "suggestedMotionProvider": "reolink-native",
  "suggestedMotionReason": "Reolink camera — native api.cgi preferred"
}
```

---

## Tests

```bash
npm test
```

---

## Related docs

- [MATTER-CAMERA.md](./MATTER-CAMERA.md) — Matter motion clusters
- [SCALING.md](./SCALING.md) — multi-node limits
- [AGENT-CONTEXT.md](./AGENT-CONTEXT.md) — deploy handoff
