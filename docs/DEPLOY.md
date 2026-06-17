# Production deploy (maintainers)

Remote deployment to a dedicated bridge host (e.g. mini PC on the camera VLAN). Testers should use [INSTALL.md](INSTALL.md) instead.

## Prerequisites

- SSH access to the target host
- Docker + Compose on the host
- `rsync` and `ssh` on your workstation

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEPLOY_HOST` | `192.168.1.50` | Target host |
| `DEPLOY_USER` | `patricktd` | SSH user |
| `DEPLOY_DIR` | `/opt/matter-cameras` | Remote install path |

## Full deploy

Rebuilds images and syncs the full tree (excluding runtime data). **Bumps `package.json` patch by +0.0.1** before build:

```bash
npm run deploy
# or
./scripts/deploy.sh
```

## Quick deploy (code-only)

Bumps version, builds TypeScript, syncs `dist/`, `views/`, `package.json`, restarts **app**:

```bash
npm run quick-deploy
# or
./scripts/quick-deploy.sh
```

Pass `--no-bump` to skip the version increment (e.g. when `npm run quick-deploy` already bumped).

## Verify deployed version

```bash
curl -s http://${DEPLOY_HOST:-192.168.1.50}:3202/api/version
grep '"version"' package.json   # must match
```

Startup log: `Starting MatterCameras vX.Y.Z-beta...`

`docker-compose.yml` bind-mounts `./dist` so the app container picks up JS without an image rebuild.

## Never overwrite on the server

| Path | Why |
|------|-----|
| `data/cameras.json` | Operator camera roster; hub references endpoint IDs |
| `data/matter-storage/` | Matter fabric, ACLs, credentials — loss requires full re-pair |
| `data/go2rtc.yaml` | Operator-tuned WebRTC (quick-deploy skips it) |
| `.env` | Secrets |

Deploy scripts use explicit `rsync --exclude` for these paths. **Do not** ship opaque tarballs over `data/`.

## Recovery

- **Lost `cameras.json`:** re-add cameras in the Web UI. Reuse the same camera IDs from startup logs if you need hub continuity (`Adding bridged camera: <name> (<id>)`).
- **Lost `matter-storage/`:** delete hub pairing for the bridge and commission again with a new QR.

## Host networking

`docker-compose.yml` uses `network_mode: host` so Matter commissioning and mDNS work. Port list matches [INSTALL.md#ports](INSTALL.md#ports).
