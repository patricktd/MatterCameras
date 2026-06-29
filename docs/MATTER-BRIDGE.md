# Matter bridge behavior

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

## What controllers expect

Matter hubs and apps that support third-party Matter bridges should:

1. Onboard all bridged devices when the bridge is commissioned.
2. Monitor aggregator `PartsList` (and related descriptor changes) so new or removed bridged endpoints appear in the app without restarting the bridge.

How well each platform does this varies — see [Platform notes: SmartThings](#platform-notes-smartthings) below.

## How other bridges behave

Typical Zigbee/Wi-Fi Matter bridges (lights, plugs):

1. User adds device in the vendor app.
2. Bridge creates a **dynamic Matter endpoint** at runtime.
3. Bridge updates **Aggregator `PartsList`** and sends an **attribute report** to subscribed hubs.
4. The hub app shows the new device within seconds — **no bridge reboot**.

## How MatterCameras works

| Step | Implementation |
|------|----------------|
| Aggregator | `AggregatorEndpoint` on endpoint `1` (`src/matter/Bridge.ts`) |
| Cameras before Matter online | All cameras from `data/cameras.json` are registered **before** `bridge.start()` so the hub never sees an empty `PartsList` |
| Add while paired | Runtime `aggregator.add()` + `PartsList` / `softwareVersion` announce; operator can use **Restart Required** when a manual bridge reload is desired |
| Hub notification | `notifyHubStructureChange()` bumps `softwareVersion` and re-reports aggregator `PartsList` |

### One child device per bridged endpoint

At pairing, the hub walks the aggregator `PartsList` and typically creates a **child device for every Matter endpoint**, including empty placeholders. A “slot pool” of reserved camera endpoints therefore showed dozens of useless cameras in SmartThings — **not viable**.

Only **real cameras** from `cameras.json` are exposed on the bridge.

### Why dynamically added cameras may not appear

Some hubs build Matter **subscription paths** from the endpoint list seen at **first pairing** (e.g. only `2.*.*` … `7.*.*` for six cameras). When endpoint `8` is added later, the bridge updates `PartsList` and sends reports, but the hub may **not subscribe** to the new endpoint and may not create a child device.

This is a **controller / Matter camera driver limitation** on some platforms (observed on SmartThings), not a bridge bug. Light bridges often sync more reliably than Matter Camera (`0x0142`).

**Workaround:** remove and re-pair the bridge after adding cameras (cameras stay in `data/cameras.json`). Adding cameras **before** the first hub pairing avoids this for the initial roster.

### Why camera bridges can feel slower than light bridges

1. **Matter Camera (`0x0142`)** is heavier than On/Off Light — hubs use different drivers and profiling; first snapshot may take minutes.
2. **Hub caching** — if `PartsList` reports are missed (e.g. during an old full-process restart), the hub keeps a stale roster until refresh or reprofile.
3. **Camera stack maturity** — Matter camera support is newer than Matter switch/bridge on many platforms; auto-sync is not always as seamless as vendor marketing implies.

## If a new camera does not appear on the hub

Bridge side (should appear in logs):

```
Adding bridged camera: Garagem (cam-…)
Bridge structure: N camera(s), softwareVersion=30N, Matter endpoints=[…]
```

Hub side (confirms the controller sees the endpoint):

```
CaptureSnapshot camera=cam-…
```

**If `Adding bridged` / `Bridge structure` appear but there is no `CaptureSnapshot` for that camera ID**, the bridge is fine — the hub has not created the child device yet.

Try:

1. After adding a camera in the Web UI, watch for bridge-side logs such as `Adding bridged camera` and `Bridge structure`.
2. Open **MatterCameras Bridge** in the hub app → pull down to refresh.
3. Wait 2–5 minutes for card preview (hub polling).
4. **Remove and re-pair the bridge** (cameras stay in `data/cameras.json`) — required if the hub paired before those cameras existed.
5. Use **Restart Required** in the Web UI only as a last resort.

## Operational limits

See [SCALING.md](SCALING.md) — many Matter bridges recommend staying under ~50 bridged devices per aggregator for stable operation.

---

## Platform notes: SmartThings

Samsung documents third-party Matter bridges as:

> When users commission Matter bridges to SmartThings, we … automatically onboard all bridged devices … We also continually synchronize with the bridge, so that if a user adds or removes a bridged device in your app, SmartThings responds immediately.

Source: [SmartThings blog — third-party Matter bridges](https://blog.smartthings.com/matter/unlocking-seamless-connectivity-smartthings-offers-support-for-third-party-matter-bridges/)

In practice, SmartThings Matter **camera** endpoints sync less reliably than light bridges. SmartThings-specific quirks (subscription paths, edge drivers, reprofile) are covered in the sections above and in [MATTER-CAMERA.md](MATTER-CAMERA.md).

Samsung recommends staying under ~**50** bridged Matter devices per bridge ([1Home reference](https://tr.docs.netlify.1home.io/docs/en/server/matter-bridge/apps/samsung-smartthings)).
