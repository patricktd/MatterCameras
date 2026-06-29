# Production deploy (maintainers)

Remote deployment to a dedicated bridge host (e.g. mini PC on the camera VLAN). Testers should use [INSTALL.md](INSTALL.md) instead.

## Prerequisites

- SSH access to the target host
- Docker + Compose on the host
- `rsync` and `ssh` on your workstation

### Windows workstation

On **Windows** (especially **ARM64** PCs), use the root **PowerShell** wrappers (`.ps1`) or `.cmd` shortcuts. They sync files with **Git `tar` + OpenSSH** instead of `rsync`, because MSYS2/Cygwin `rsync` builds often crash on ARM Windows when launched from Git Bash.

| Tool | Typical install |
|------|-----------------|
| `bash` | [Git for Windows](https://git-scm.com/download/win) (remote Docker step only) |
| `tar` | Included with Git for Windows (`Git\usr\bin\tar.exe`) |
| `ssh` / `scp` | Windows OpenSSH or Git for Windows |

Linux/macOS maintainers still use `rsync` via `scripts/deploy.sh`.

**Do not rely on WSL `bash.exe`** in PowerShell — it often appears first in `PATH` and fails when WSL mount/state is broken.

Deploy scripts reuse one SSH connection when **Git for Windows** `ssh` is used (multiplexing). The built-in **Windows OpenSSH** client does not support this — install [Git for Windows](https://git-scm.com/download/win) if you see `getsockname failed: Not a socket`.

For passwordless deploy, add your SSH public key to the bridge host (`ssh-copy-id`).

Preferred option: use the root **PowerShell** wrappers (`.ps1`).

If PowerShell blocks local scripts, run once in that terminal:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Both the `.ps1` and `.cmd` wrappers forward to the existing bash deploy scripts.

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

Rebuilds images, syncs the full tree **and `dist/`** (required — see below). Does **not** change `package.json` version:

```bash
npm run deploy
# or
./scripts/deploy.sh
# or
./deploy.sh
```

Use full deploy when adding or upgrading **npm dependencies** (e.g. `onvif`) — the Docker image runs `npm ci` at build time.

## Quick deploy (code-only)

Builds TypeScript (if needed), syncs `dist/`, `views/`, `public/`, `package.json`, restarts **app**:

```bash
npm run quick-deploy
# or
./scripts/quick-deploy.sh
# or
./quick-deploy.sh
```

Both scripts end with **`docker compose restart app`** so `/api/version` reflects the bind-mounted `package.json` (read once at Node startup).

## Release versioning

Deploy and quick-deploy **never** bump the version. For a community release:

```bash
npm run release              # patch: 0.3.63-beta → 0.3.64-beta
npm run release:minor        # minor: 0.3.63-beta → 0.4.0-beta
npm run release:major        # major: 0.3.63-beta → 1.0.0-beta
# or: node scripts/release-version.mjs 0.4.0-beta
```

Then move `CHANGELOG.md` `[Unreleased]` entries under `[X.Y.Z] — date`, commit, tag (`git tag v0.3.64-beta`), and deploy.

## Root shortcuts

The repository root also includes simple wrappers for convenience:

```bash
./sync.sh           # safe fetch + fast-forward-only pull when clean
./deploy.sh         # forwards to scripts/deploy.sh
./quick-deploy.sh   # forwards to scripts/quick-deploy.sh
./commit.sh "message" [--push]
```

Windows equivalents:

```bat
sync.cmd
deploy.cmd
quick-deploy.cmd
commit.cmd "message" [--push]
```

Preferred PowerShell equivalents:

```powershell
./sync.ps1
./deploy.ps1
./quick-deploy.ps1
./commit.ps1 "message"
./commit.ps1 "message" -Push
```

`commit.sh` stages all changes with `git add -A`, creates a commit, and optionally pushes the current branch when `--push` is supplied.
`commit.cmd` does the same for Windows shells.
`commit.ps1` does the same for PowerShell.
`sync.*` is the safe “start working on this machine” helper: fetch, inspect branch state, and pull only when a fast-forward is safe.

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

## Local-only maintainer files (not in git)

Production hostnames, deploy targets, and AI handoff notes live in paths that are **gitignored** and must not be pushed to the public repository:

- `deploy.env` — SSH target for `npm run deploy`
- `docs/AGENT-CONTEXT.md` — maintainer/agent handoff (copy from a private template if needed)
- `.cursor/rules/` — Cursor rules for local development

Keep production IPs, credentials, and internal runbooks out of tracked files (`README.md`, `CHANGELOG.md`, `docs/**` that ship on GitHub).

## Host networking

`docker-compose.yml` uses `network_mode: host` so Matter commissioning and mDNS work. Port list matches [INSTALL.md#ports](INSTALL.md#ports).
