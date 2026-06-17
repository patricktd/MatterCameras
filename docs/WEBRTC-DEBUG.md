# WebRTC live view debugging (SmartThings / Matter)

Bridge: **MatterCameras** on `192.168.1.50` → SmartThings hub via Matter 1.5 Camera (`0x0142`).

## Current status (2026-06-09)

| Feature | iOS (SmartThings app) | Android |
|---------|----------------------|---------|
| Snapshot | OK | OK |
| Live view (video) | **OK** — fast first attempt | **OK** — operator confirmed 2026-06-09 |
| Live view (audio) | **OK** | **OK** (with video) |

**Working stack:** patched go2rtc + hub-offer filtering + `prepareHubOfferForGo2rtc` + serialized `ProvideOffer` + **deferred hub signaling** (see below).

### Root fix — `ProvideOfferResponse` before `answer` (2026-06-09)

Matter 1.5 §11.5.7.4: the hub **creates** the `WebRtcTransportRequestor` session when it receives **`ProvideOfferResponse`**, not when it sends `ProvideOffer`.

The bridge used to invoke `answer` on the hub **before** returning `ProvideOfferResponse`. That caused:

```
WebRTC answer delivery failed hubEp=0: … NotFound (139)
Invoke error … provideOffer: Status=UnsupportedAccess(126)
```

Even when go2rtc had a valid SDP answer, the hub had no session to accept it. Retries and second app attempts sometimes worked by luck; after hub re-interview (motion deploy) the failure became consistent.

**Fix** (`MatterWebRtcTransportProviderServer.ts`):

1. Return `ProvideOfferResponse` with `webRtcSessionId` immediately after go2rtc exchange.
2. After **80 ms**, invoke `WebRtcTransportRequestor.answer` + ICE trickle (deferred `#deliverHubSignalingAfterResponse`).
3. Keep retry backoff on `answer` for transient `NotFound`.

**Operator result:** iOS and Android live view work on **first attempt**, noticeably faster than before (no failed `answer` round-trips or hub retries).

### Historical note — Android “DTLS blocker” (2026-06-08, superseded)

Earlier tests attributed Android failure to DTLS never completing in go2rtc. With correct signaling order, **Android live view works**. The DTLS symptoms were likely downstream of the hub never receiving a timely `answer` (ICE connected but media path never fully established). See [Verified test log — Android (2026-06-08, FAIL)](#verified-test-log--android-2026-06-08-fail) for the old log analysis.

---

## Verified test log — iOS + Android (2026-06-09, OK)

**Fix:** deferred hub signaling (`ProvideOfferResponse` before `answer`).

**Operator report:** live view works on **iOS and Android**, loads much faster on first attempt (no retry loop).

**Log signature (success):**

```
ProvideOffer camera=cam-… session=1 …
go2rtc WebRTC answer camera=cam-… mode=whep sdp=2202ch relay=0
Invoke » … provideOffer webRtcSessionId: 1 videoStreamId: 1    # response sent first
WebRTC answer delivered session=1 hubEp=0 attempt=1
ICE candidates delivered session=1 hubEp=0 count=1
```

**go2rtc:** `ICE connection state changed: connected` → `Handshake Completed` (iOS and Android).

---

## Verified test log — iOS (2026-06-08, before signaling fix)

**Environment:** iPhone on LAN `192.168.1.120`, bridge `192.168.1.50:8555`, hub TURN `turn-useast1.smartthings.com`.

**Deploy baseline:** app rebuild ~21:03 UTC (concurrency fix: recycle + exchange under one lock, no prewarm in `ProvideOffer`).

### Cameras (example)

| ID | Name |
|----|------|
| `cam-example-1` | Front Door |
| `cam-example-2` | Driveway |
| `cam-example-3` | Side Yard |
| `cam-example-4` | Backyard |

### Results (operator report + logs)

| Camera | Live view | Audio | Notes |
|--------|-----------|-------|-------|
| Front Door | OK | OK | Sometimes 2nd attempt |
| Driveway | OK | OK | Sometimes 2nd attempt |
| Side Yard | OK | OK | Sometimes 2nd attempt |
| Backyard | OK | OK | First try ~5 s answer delay |

### Log signatures (success)

**App (`matter_cameras`):**

```
ProvideOffer camera=cam-… session=1 … hubIceServers=1
Filtered hub offer ICE session=1 32→4 (LAN host only, ice-lite hint for go2rtc)
go2rtc WebRTC answer camera=cam-… mode=whep sdp=2202ch relay=0
WebRTC answer delivered session=1 hubEp=0
ICE candidates delivered session=1 hubEp=0 count=1
```

**go2rtc (`matter_go2rtc`):**

```
ICE connection state changed: connected
Handshake Completed
nominated: true
192.168.1.50:8555 <-> 192.168.1.120:<ephemeral>
```

SDP answer ~**2202 chars** (video + Opus audio). Earlier video-only answers were ~2020 chars.

### First attempt vs second attempt

| Attempt | Typical answer delay | Why |
|---------|---------------------|-----|
| 1st (cold ffmpeg) | **~3–5 s** | `ffmpeg:…#video=h264#audio=opus` spins up on first WebRTC consumer |
| 2nd (warm ffmpeg) | **~20–50 ms** | ffmpeg already running; hub retry succeeds quickly |

SmartThings may show an error on the 1st attempt if the hub UI times out before video keyframes arrive. **Retrying live view usually works.**

Example from logs:

| Camera | 1st `ProvideOffer` | Answer delay | 2nd `ProvideOffer` | Answer delay |
|--------|-------------------|--------------|-------------------|--------------|
| Side Yard | 21:05:40 | ~5 s | 21:05:58 | ~20 ms |
| Driveway | 21:06:34 | ~2 s | 21:07:01 | ~20 ms |
| Backyard | 21:08:00 | ~5 s | 21:08:19 | ~30 ms |

---

## Android blocker (2026-06-08 — superseded; see [root fix](#root-fix--provideofferresponse-before-answer-2026-06-09))

**Bridge is not the bottleneck.** On Android (`192.168.1.63`), logs consistently show:

| Stage | Status |
|-------|--------|
| Matter signaling | OK — answer + ICE candidates delivered |
| ICE (warm retry) | Often OK — `nominated: true`, `192.168.1.63` |
| DTLS | **FAIL** — go2rtc `answer-setup=[passive,passive]` waits for ClientHello; **Android never completes DTLS** |
| `Handshake Completed` | **Never** observed for `.63` after many builds |

Attempts tried without breaking iOS:

- ice-lite + LAN ICE filter (iOS path)
- setup flip → dual DTLS client deadlock
- full hub ICE (12 candidates) → srflx noise + worse overlap
- prewarm + inline candidates in answer SDP

**Conclusion:** SmartThings **Android** app likely does not complete WebRTC DTLS with Matter bridged cameras. Snapshots work; live view needs Samsung fix or use **iOS** until then.

Report to Samsung SmartThings with: Matter bridge, Camera cluster 0x0142, hub offer ~4210 ch / 12 candidates / `setup=actpass`, bridge answer `setup=passive`, ICE succeeds, DTLS never starts.

---

## Verified test log — Android (2026-06-08, FAIL)

**Environment:** Android phone on LAN **`192.168.1.63`**, bridge `192.168.1.50:8555`.

**Operator report:** live view failed on **all cameras**.

### Results (logs 21:12–21:14 UTC)

| Camera | Live view | Signaling | ICE | DTLS | Notes |
|--------|-----------|-----------|-----|------|-------|
| Front Door | FAIL | OK | connected + nominated | **never** | 1st ~5 s answer; hub retry ~12 s |
| Driveway | FAIL | OK | connected + nominated | **never** | disconnected ~16 s after connect |
| Side Yard | FAIL | OK | failed (overlap) | **never** | STUN `error response` on retry |
| Backyard | (not in log window) | — | — | — | operator says all failed |

### What works on Android (same as iOS)

```
ProvideOffer … sdp=4210ch hubIceServers=1        # vs iOS ~6970ch
Filtered hub offer ICE session=1 12→4
go2rtc WebRTC answer … sdp=2198ch relay=0
WebRTC answer delivered session=1 hubEp=0
ICE candidates delivered session=1 count=1 (×2 + end-of-candidates)
```

Signaling and ICE nomination **succeed**. go2rtc selects `192.168.1.50:8555 ↔ 192.168.1.63:<ephemeral>` with `nominated: true`.

### Root cause: DTLS handshake never completes

| Platform | After ICE `connected` | DTLS |
|----------|----------------------|------|
| iOS `.120` | ~600 ms | `Flight 0 → Flight 4` → **`Handshake Completed`** |
| Android `.63` | stays in `Flight 0: Waiting` | **no `Handshake Completed`** (21:12–21:14) |

go2rtc acts as **DTLS server** (`[handshake:server] Flight 0: Sending/Waiting`). iOS responds with ClientHello quickly; **Android never sends ClientHello** (or it never reaches the bridge).

Symptoms after ICE connect:

```
sender_interceptor WARNING: failed sending: the DTLS transport has not started yet
dtls TRACE: [handshake:server] Flight 0: Sending / Waiting   # retries every ~2 s
```

Hub retries (~12 s) open a **second** PeerConnection while the first is still closing → `Unhandled STUN … class(error response)` → ICE `failed`.

### iOS vs Android differences (same bridge build)

| | iOS | Android |
|---|-----|---------|
| Hub LAN IP | `192.168.1.120` | `192.168.1.63` |
| Hub offer size | ~6962–6974 ch | ~4196–4210 ch |
| Hub candidates in offer | 32 → 4 filtered | 12 → 4 filtered |
| `Handshake Completed` after 21:12 | yes (earlier tests) | **none** |

### Fixes deployed (Android DTLS experiment)

1. **Hub offer diagnostics** — each `ProvideOffer` logs `setup`, fingerprint prefix, candidate count.
2. **Compact-hub path (Android)** — offers &lt;5500 ch **and** ≤16 candidates: full hub ICE to go2rtc (no filter), prewarm, recycle on retry. **Do not flip `setup:actpass`** — caused dual DTLS client deadlock (`handshake:client` with no Android response).
3. **iOS unchanged** — filtered LAN ICE + ice-lite hint; recycle only on same-session retry.
4. **Inline bridge candidate** in answer SDP body plus Matter trickle.

Retest Android; success = `Handshake Completed` in go2rtc within ~2 s of ICE `connected`.

### Monitor during Android retest

```bash
./scripts/watch-webrtc-logs.sh 2m
```

Success criteria: `Handshake Completed` in go2rtc within ~2 s of `ICE connection state changed: connected`.

---

## Symptom checklist

| Stage | OK signal | Failure signal |
|-------|-----------|----------------|
| Snapshot | JPEG ~20–40 KB | HTTP 404 / empty body |
| Signaling | `ProvideOffer` → answer in &lt;6 s (warm) or &lt;10 s (cold) | No `go2rtc answer` / timeout |
| ICE | `connected` + `nominated: true` | `failed` / `error response` STUN |
| Media | `Handshake Completed` | DTLS never starts |
| Audio | Opus in SDP (~2202 ch); listen works in app | `m=audio` port 9 / no button |

---

## Fixes applied (chronological)

### 1. pion `MaxBindingRequests` too low

LAN STUN RTT ~25 ms; default limit 7 exhausted in ~11 ms.

**Patch:** `docker/go2rtc/patch-ice.diff` → `SetICEMaxBindingRequests(100)`.

### 2. Noisy bridge candidates

14 local candidates (TCP, srflx, relay) confused hub ICE scoring.

**Patches:**

- `patch-candidates.diff` — host UDP only on `filters.ips`
- Matter `filterLocalBridgeCandidates` + `filterSdpToLocalBridgeCandidate` — one RTP candidate to hub
- `data/go2rtc.yaml` — `ice_servers: []`, `networks: [udp4]`

### 3. Hub never nominates (iOS `.120`, Android `.140` early tests)

Signaling OK, pairs `succeeded`, but `nominated: false` until ICE failed.

**Patch 3 (working):**

| Layer | Change |
|-------|--------|
| Matter `prepareHubOfferForGo2rtc` | Strip hub srflx/relay from offer **copy**; add `a=ice-lite` on copy only so go2rtc becomes ICE **controlling** and sends `USE-CANDIDATE` |
| go2rtc `api.go` | `SetHostAcceptanceMinWait(0)`; defer srflx/relay nomination |
| Matter app | Do **not** forward hub `ice_servers` into go2rtc |

### 4. Overlapping PeerConnections (regression 21:00–21:01 UTC)

`prewarm` and `exchange` used separate locks → hub retry opened 2nd PC → `Unhandled STUN error response`.

**Fix:** remove prewarm from `ProvideOffer`; recycle + exchange under **one lock**; serialize `ProvideOffer` per camera endpoint (`#offerChain`).

### 5. Audio

Stream was `ffmpeg:…#video=h264` only → hub had no listen button.

**Fix:** `ffmpeg:…#video=h264#audio=opus` in `Go2RTCClient.#toWebRtcSrc`. Verified on iOS all cameras.

---

## Patched go2rtc build

```bash
cd docker/go2rtc && docker build -t matter-go2rtc:patched .
# Server:
docker compose build --no-cache go2rtc && docker compose up -d go2rtc
```

Patches: `patch-ice.diff` (MaxBinding + acceptance waits), `patch-candidates.diff` (host UDP only).

## go2rtc.yaml (per-host)

Use `data/go2rtc.yaml.example` / `scripts/setup.sh` — replace `__LAN_IP__` with the bridge LAN address:

```yaml
webrtc:
  listen: ":8555"
  candidates:
    - 192.168.1.50:8555
  ice_servers: []
  filters:
    networks: [udp4]
    ips: [192.168.1.50]
```

## Deploy procedure

**Never overwrite** `data/cameras.json`, `data/config.json`, `data/go2rtc.yaml`, or `data/matter-storage/`.
Configure `deploy.env` first (see `docs/DEPLOY.md`).

```bash
./scripts/deploy.sh          # full
npm run build && ./scripts/quick-deploy.sh   # JS only (rebuild image if TS changed!)
```

After TypeScript changes: `docker compose build --no-cache app && docker compose up -d app`.

## Related files

| File | Role |
|------|------|
| `docker/go2rtc/patch-ice.diff` | MaxBindingRequests + host acceptance waits |
| `docker/go2rtc/patch-candidates.diff` | Trickle filter: host UDP only |
| `src/matter/webrtcIce.ts` | `prepareHubOfferForGo2rtc`, candidate filters |
| `src/matter/behaviors/MatterWebRtcTransportProviderServer.ts` | Signaling, session queue |
| `src/streaming/Go2RTCClient.ts` | ffmpeg WebRTC src, lock, recycle |
| `scripts/watch-webrtc-logs.sh` | Live log tail for tests |
