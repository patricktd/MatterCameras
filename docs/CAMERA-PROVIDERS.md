# Camera add providers

Plugins for discovering and pre-filling cameras in the Web UI — similar to Scrypted’s per-vendor add flow.

## Architecture

```
Web UI tabs → POST /api/camera-providers/:id/discover|resolve
                    ↓
            src/cameraProviders/registry.ts
                    ↓
     unifi-protect | reolink | tapo-sonoff | onvif | manual
                    ↓
            ResolvedCameraDraft → cameras.json + go2rtc
```

Each provider implements:

| Method | Purpose |
|--------|---------|
| `discover` | List devices not already in `cameras.json` |
| `resolve` | Return `name`, `rtspUrl`, motion/vendor fields |

Motion detection still uses `src/motion/` providers after the camera is saved.

## Built-in providers

| Id | Label | Discover | RTSP source |
|----|-------|----------|-------------|
| `unifi-protect` | UniFi Protect | Login to controller → list adopted cameras | `rtsps://user:pass@host:7441/{rtspAlias}` from Protect bootstrap |
| `reolink` | Reolink | `GetDevInfo` on host → channels | `rtsp://host:554/h264Preview_XX_main` |
| `tapo-sonoff` | Tapo / Sonoff | Camera IP → ONVIF :2020 | ONVIF `GetStreamUri` (Camera Account credentials) |
| `onvif` | ONVIF | WS-Discovery UDP 3702 | ONVIF `GetStreamUri` |
| `manual` | Manual RTSP | — | Operator pastes URL |

## Saved UniFi Protect controller

Operator-managed file: `data/settings.json` (excluded from deploy rsync).

- **Options** → save host, local user, password once
- Or **Remember controller login** when listing cameras in the add wizard
- Motion on UniFi cameras falls back to saved credentials when per-camera `username` is empty

## Bulk UniFi operations

| Endpoint | Purpose |
|----------|---------|
| `POST /api/camera-providers/unifi-protect/import` | Add all new Protect cameras (`deviceIds` optional). Body: `saveController`, credentials |
| `POST /api/camera-providers/unifi-protect/sync-existing` | Set `protectHost` / `protectCameraId` on roster cameras matched by **name** or **RTSP alias** |

Web UI: **Import all new** · **Link existing cameras** on the UniFi Protect tab.

## API

- `GET /api/camera-providers` — list provider metadata for the UI
- `POST /api/camera-providers/:id/discover` — body: provider-specific credentials (`host`, `username`, `password`, `timeoutMs`)
- `POST /api/camera-providers/:id/resolve` — body: `deviceId`, `payload`, credentials
- `GET /api/settings/controllers` — public view of saved logins (no passwords)
- `PUT /api/settings/protect-controller` — save UniFi controller login
- `DELETE /api/settings/protect-controller` — clear saved login

Legacy routes `/api/onvif/discover` and `/api/onvif/resolve` delegate to the ONVIF provider.

## Adding a new provider

1. Create `src/cameraProviders/myVendorProvider.ts` implementing `CameraAddProvider`.
2. Register in `src/cameraProviders/registry.ts`.
3. Add a tab + panel in `views/partials/add-camera-panel.ejs` and wire `dashboard.js` credentials if needed.
4. If motion needs a new backend, add a motion provider in `src/motion/providers/` (separate concern).

## Related

- Motion backends: [MOTION-PROVIDERS.md](./MOTION-PROVIDERS.md)
- Scrypted research: [MOTION-PROVIDERS-PHASE0.md](./MOTION-PROVIDERS-PHASE0.md)
