# Production deploy (maintainers)

Remote deployment to a dedicated bridge host (e.g. mini PC on the camera VLAN). Testers should use [INSTALL.md](INSTALL.md) instead.

## Prerequisites

- SSH access to the target host
- Docker + Compose on the host
- `rsync` and `ssh` on your workstation

## Configure deploy target

Copy `deploy.env.example` → `deploy.env` (gitignored) and set your host:

```bash
cp deploy.env.example deploy.env
# edit DEPLOY_HOST, DEPLOY_USER, DEPLOY_DIR
```

| Variable | Example | Purpose |
|----------|---------|---------|
| `DEPLOY_HOST` | `192.168.1.50` | Target host LAN IP |
| `DEPLOY_USER` | `bridge` | SSH user |
| `DEPLOY_DIR` | `/opt/matter-cameras` | Remote install path |

`scripts/deploy.sh`, `quick-deploy.sh`, and `watch-webrtc-logs.sh` all require `deploy.env`.

## Full deploy

Rebuilds images, syncs the full tree **and `dist/`** (required — see below). **Bumps `package.json` patch by +0.0.1** before build:

```bash
npm run deploy
# or
./scripts/deploy.sh
```

Use full deploy when adding or upgrading **npm dependencies** (e.g. `onvif`) — the Docker image runs `npm ci` at build time.

## Quick deploy (code-only)

Bumps version, builds TypeScript, syncs `dist/`, `views/`, `public/`, `package.json`, restarts **app**:

```bash
npm run quick-deploy
# or
./scripts/quick-deploy.sh
```

Pass `--no-bump` to skip the version increment (e.g. when `npm run quick-deploy` already bumped).

Both scripts end with **`docker compose restart app`** so `/api/version` reflects the bind-mounted `package.json` (read once at Node startup).

## `dist/` bind-mount (important)

`docker-compose.yml` mounts `./dist:/app/dist:ro`. The running container always executes **host** `dist/`, not only the copy baked into the image.

- Both `deploy.sh` and `quick-deploy.sh` rsync `dist/` after local `npm run build`.
- Symptom if skipped: new API routes 404 (`Cannot POST /api/onvif/discover`) even after a successful image rebuild.

## Verify deployed version

```bash
source deploy.env
curl -s "http://${DEPLOY_HOST}:3202/api/version"
grep '"version"' package.json   # must match
```

Startup log: `Starting MatterCameras vX.Y.Z-beta...`

`docker-compose.yml` bind-mounts `./dist` so the app container picks up JS without an image rebuild.

## Never overwrite on the server

Deploy scripts **never rsync** these paths from the workstation:

| Path | Why |
|------|-----|
| `data/cameras.json` | Operator camera roster; hub references endpoint IDs |
| `data/config.json` | Per-host `matterHost` / ports (`setup.sh` on the server) |
| `data/go2rtc.yaml` | Per-host WebRTC ICE candidates |
| `data/matter-storage/` | Matter fabric, ACLs, credentials — loss requires full re-pair |
| `.env` | Secrets |
| `deploy.env` | Local deploy target only |

`scripts/deploy.sh` uses explicit `rsync --exclude` for each path. **Do not** ship opaque tarballs over `data/`.

## Recovery

- **Lost `cameras.json`:** re-add cameras in the Web UI. Reuse the same camera IDs from startup logs if you need hub continuity (`Adding bridged camera: <name> (<id>)`).
- **Lost `matter-storage/`:** delete hub pairing for the bridge and commission again with a new QR.
- **Wrong `matterHost` after moving hardware:** re-run `bash scripts/setup.sh --host <new-ip>` on the server or edit `data/config.json` + `data/go2rtc.yaml` there.

## Host networking

`docker-compose.yml` uses `network_mode: host` so Matter commissioning and mDNS work. Port list matches [INSTALL.md#ports](INSTALL.md#ports).
