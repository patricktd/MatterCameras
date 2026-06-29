#!/usr/bin/env bash
set -euo pipefail

if command -v uname >/dev/null 2>&1 && uname -s 2>/dev/null | grep -qiE 'mingw|msys'; then
    echo "On Windows, use ./deploy.ps1 or npm run deploy (tar+ssh sync)." >&2
    echo "Git Bash + rsync often crashes on ARM Windows." >&2
    exit 1
fi

# NEVER rsync these runtime paths from the workstation (see also docs/DEPLOY.md):
#   data/cameras.json, data/config.json, data/go2rtc.yaml, data/matter-storage/, .env

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_NODE="$ROOT"
if command -v cygpath >/dev/null 2>&1; then
  ROOT_NODE="$(cygpath -w "$ROOT")"
fi
# shellcheck source=deploy-env.sh
source "${ROOT}/scripts/deploy-env.sh"
load_deploy_env "${ROOT}"

# shellcheck source=deploy-ssh-env.sh
source "${ROOT}/scripts/deploy-ssh-env.sh"
setup_deploy_ssh
deploy_ssh_mux_start
trap 'deploy_ssh_mux_stop' EXIT

HOST="${DEPLOY_HOST}"
USER="${DEPLOY_USER}"
DEST="${DEPLOY_DIR}"

if [ ! -d "${ROOT}/dist" ]; then
    echo "==> Building (dist/ missing)..."
    npm run build --prefix "${ROOT_NODE}"
fi

DEPLOY_VERSION="$(node -e "const fs=require('fs'); const path=require('path'); const root=process.argv[1]; const pkg=JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); console.log(pkg.version);" "${ROOT_NODE}")"
echo "==> Deploy MatterCameras v${DEPLOY_VERSION} → ${USER}@${HOST}:${DEST}"

export RSYNC_RSH="${DEPLOY_RSYNC_RSH}"

rsync -rlvz --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude data/matter-storage \
  --exclude data/cameras.json \
  --exclude data/config.json \
  --exclude data/go2rtc.yaml \
  --exclude data/settings.json \
  --exclude '*.expect' \
  --exclude .env \
  --exclude deploy.env \
  --exclude .analysis \
  --exclude .cursor/ST-beta \
  --exclude .cursor/ST-main \
  "${ROOT}/" "${USER}@${HOST}:${DEST}/"

# Host bind-mounts ./dist over the image — sync compiled JS so runtime matches the build.
if [ ! -d "${ROOT}/dist" ]; then
    echo "ERROR: ${ROOT}/dist not found. Run 'npm run build' first." >&2
    exit 1
fi

rsync -rlvz --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude test \
  --exclude '.DS_Store' \
  --exclude '._*' \
  "${ROOT}/dist/" "${USER}@${HOST}:${DEST}/dist/"

echo "==> Building and starting containers..."
bash "${ROOT}/scripts/deploy-remote.sh" full

echo "==> Deploy complete (v${DEPLOY_VERSION})."
echo "    Verify: curl -s http://${HOST}:3202/api/version"
