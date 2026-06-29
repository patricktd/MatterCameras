# Scaling limits and recommendations

Reference for anyone deploying or operating the MatterCameras bridge in production.

## Ecosystem limits

| Layer | Practical limit | Notes |
|-------|-----------------|-------|
| **Matter (protocol)** | Up to **255** dynamic endpoints per bridge | Theoretical spec limit; cameras are heavy endpoints |
| **Matter bridge (typical hub)** | **~50** bridged devices with good stability | Platform-dependent; SmartThings reports instability above this in large installs ([1Home](https://tr.docs.netlify.1home.io/docs/en/server/matter-bridge/apps/samsung-smartthings)) |
| **Legacy SmartThings SmartCam (LAN)** | **4** cameras | **Does not apply** to Matter 1.5 cameras |
| **Matter Camera (spec)** | `maxConcurrentEncoders` per endpoint | This bridge advertises **1** encoder per camera (RTSP → ffmpeg H.264) |

## Recommendations by installation size

Estimates for a dedicated server (e.g. NUC / mini PC on the same LAN as the cameras), with UniFi/RTSP H.265 cameras transcoded via ffmpeg:

| Cameras | Snapshots (preview) | Live view (WebRTC) | Hardware |
|---------|---------------------|--------------------|----------|
| **1–2** | Reliable | One stream at a time; stable after correct TURN/ICE | 2+ cores, 4 GB RAM |
| **3–4** | Reliable | **One live view at a time** recommended | 4+ cores, 8 GB RAM |
| **5–8** | Generally OK | CPU/ffmpeg contention; avoid simultaneous live views | 6+ cores, 16 GB RAM |
| **9+** | Degraded | Not recommended on a single node | Multiple nodes or native H.264 on the camera |

## Bottlenecks in this bridge

1. **ffmpeg per camera** — the `_webrtc` stream transcodes H.265→H.264 (~5 s cold start, ongoing CPU).
2. **WebRTC / TURN** — live view depends on ICE + hub TURN relay; snapshots do not use WebRTC.
3. **Hub** — may retry `ProvideOffer` if media does not connect within ~30 s.
4. **go2rtc** — 2 streams registered per camera (direct RTSP + ffmpeg WebRTC).

## Best practices for public release

- Document **minimum hardware requirements** in the README.
- Recommend **native H.264** on RTSP when possible (eliminates ffmpeg).
- Limit or warn when adding more than **4 cameras** in the Web UI (some hub apps cap card previews).
- Use a **standalone Matter hub** with Matter 1.5 camera firmware (e.g. Aeotec / SmartThings — not a TV-embedded hub).
- Keep the bridge and cameras on the **same subnet**; WebRTC uses UDP **8555** on the host.

## References

- [SmartThings Matter cameras (Samsung)](https://news.samsung.com/global/samsung-smartthings-becomes-the-industrys-first-to-support-matter-cameras) — first major hub with Matter camera support
- [Matter 1.5.1 camera multi-stream (CSA)](https://csa-iot.org/newsroom/matter-1-5-1-enhancing-camera-performance-and-expanding-device-flexibility/)
- [1Home — SmartThings Matter bridge scale](https://tr.docs.netlify.1home.io/docs/en/server/matter-bridge/apps/samsung-smartthings)
