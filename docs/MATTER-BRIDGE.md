# Matter bridge behavior (SmartThings)

How this project implements a **Matter Aggregator bridge** and how that compares to other Matter bridges (Aqara, Hue, etc.).

## What the Matter spec requires

A Matter bridge exposes non-Matter devices as **dynamic endpoints** behind an **Aggregator** device type (`0x0E`):

1. **Aggregator endpoint** (here: Matter endpoint `1`) — Descriptor cluster `PartsList` lists every bridged camera endpoint.
2. **Each camera** — Matter Camera device type (`0x0142`) with `BridgedDeviceBasicInformation`.
3. **Runtime changes** — when a bridged device is added or removed, the bridge **SHALL** update `PartsList` on the Descriptor cluster (Matter core spec §9.13.6). Controllers **SHOULD** monitor that attribute for changes.

References:

- [Nordic Matter bridge overview](https://docs.nordicsemi.com/bundle/ncs-3.2.1/page/nrf/protocols/matter/overview/bridge.html)
- [Espressif bridge PartsList discussion](https://github.com/espressif/esp-matter/issues/77)
- [Google Home — Descriptor / PartsList](https://developers.home.google.com/matter/primer/device-data-model)

## What SmartThings promises

Samsung documents third-party Matter bridges as:

> When users commission Matter bridges to SmartThings, we … automatically onboard all bridged devices … We also continually synchronize with the bridge, so that if a user adds or removes a bridged device in your app, SmartThings responds immediately.

Source: [SmartThings blog — third-party Matter bridges](https://blog.smartthings.com/matter/unlocking-seamless-connectivity-smartthings-offers-support-for-third-party-matter-bridges/)

That sync is implemented in **hub firmware** by subscribing to bridge descriptor changes (e.g. `PartsList`) and creating/updating child devices — not by restarting the bridge.

## How other bridges behave

Typical Zigbee/Wi-Fi Matter bridges (lights, plugs):

1. User adds device in the vendor app.
2. Bridge creates a **dynamic Matter endpoint** at runtime.
3. Bridge updates **Aggregator `PartsList`** and sends an **attribute report** to subscribed hubs.
4. SmartThings shows the new device within seconds — **no bridge reboot**.

## How MatterCameras works

| Step | Implementation |
|------|----------------|
| Aggregator | `AggregatorEndpoint` on endpoint `1` (`src/matter/Bridge.ts`) |
| Cameras before Matter online | All cameras from `data/cameras.json` are registered **before** `bridge.start()` so the hub never sees an empty `PartsList` |
| Add/remove while paired | `aggregator.add()` / `endpoint.delete()` at runtime; matter.js updates `PartsList`; bridge bumps `softwareVersion` and logs structure |
| Hub notification | `notifyHubStructureChange()` after add/remove (no process restart) |

### Why camera bridges can feel slower than light bridges

1. **Matter Camera (`0x0142`)** is heavier than On/Off Light — SmartThings uses different edge drivers and profiling; first snapshot may take minutes.
2. **Hub caching** — if `PartsList` reports are missed (e.g. during an old full-process restart), the hub keeps a stale roster until refresh or reprofile.
3. **Samsung camera stack** — Matter camera support is newer than Matter switch/bridge; auto-sync is less consistent in practice than Samsung’s marketing implies.

## If a new camera does not appear in SmartThings

Bridge side (should appear in logs):

```
Adding bridged camera: Garagem (cam-…)
Bridge structure: N camera(s), softwareVersion=30N, Matter endpoints=[…]
```

Hub side (confirms SmartThings sees the endpoint):

```
CaptureSnapshot camera=cam-…
```

**If `Adding bridged` / `Bridge structure` appear but there is no `CaptureSnapshot` for that camera ID**, the bridge is fine — the hub has not created the child device yet.

Try:

1. Open **MatterCameras Bridge** in SmartThings → pull down to refresh.
2. Wait 2–5 minutes for card preview (hub polling).
3. Use **Restart Bridge** in the Web UI only as a last resort.
4. Worst case: remove and re-pair the bridge (cameras stay in `data/cameras.json`).

## Operational limits

See [SCALING.md](SCALING.md) — SmartThings recommends staying under ~50 bridged Matter devices per bridge.
