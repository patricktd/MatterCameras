#!/usr/bin/env bash
#
# Fast iteration deploy: sync compiled JS only, restart app container.
# Bumps package.json patch (+0.0.1) unless called with --no-bump (e.g. from npm run quick-deploy).
#
# NEVER syncs or overwrites on the remote host:
#   - data/cameras.json     (operator-managed camera roster)
#   - data/config.json      (matterHost / ports — per-machine)
#   - data/go2rtc.yaml      (WebRTC ICE candidates — per-machine)
#   - data/matter-storage/  (Matter fabric/credentials, irreversible if lost)
#   - .env, deploy.env      (secrets / deploy target)
#
# For a full deploy (image rebuild, etc.) use scripts/deploy.sh.

set -euo pipefail

NO_BUMP=false
for arg in "$@"; do
    case "$arg" in
        --no-bump) NO_BUMP=true ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_NODE="$ROOT"
if command -v cygpath >/dev/null 2>&1; then
  ROOT_NODE="$(cygpath -w "$ROOT")"
fi
# shellcheck source=deploy-env.sh
source "${ROOT}/scripts/deploy-env.sh"
load_deploy_env "${ROOT}"

HOST="${DEPLOY_HOST}"
USER_NAME="${DEPLOY_USER}"
DEST="${DEPLOY_DIR}"

if [ "$NO_BUMP" = false ]; then
  node "${ROOT_NODE}/scripts/bump-deploy-version.mjs"
  npm run build --prefix "${ROOT_NODE}"
fi

DEPLOY_VERSION="$(node -e "const fs=require('fs'); const path=require('path'); const root=process.argv[1]; const pkg=JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); console.log(pkg.version);" "${ROOT_NODE}")"
echo "==> Quick deploy MatterCameras v${DEPLOY_VERSION} → ${USER_NAME}@${HOST}:${DEST}"

if [ ! -d "${ROOT}/dist" ]; then
    echo "ERROR: ${ROOT}/dist not found. Run 'npm run build' first." >&2
    exit 1
fi

rsync -rlvz --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude test \
  --exclude '.DS_Store' \
  --exclude '._*' \
  "${ROOT}/dist/" "${USER_NAME}@${HOST}:${DEST}/dist/"

rsync -rlvz --omit-dir-times --no-perms --no-owner --no-group \
  --exclude '.DS_Store' \
  --exclude '._*' \
  "${ROOT}/views/" "${USER_NAME}@${HOST}:${DEST}/views/"

rsync -rlvz --omit-dir-times --no-perms --no-owner --no-group \
  --exclude '.DS_Store' \
  --exclude '._*' \
  "${ROOT}/public/" "${USER_NAME}@${HOST}:${DEST}/public/"

rsync -rlvz --omit-dir-times --no-perms --no-owner --no-group \
  "${ROOT}/docker-compose.yml" "${USER_NAME}@${HOST}:${DEST}/docker-compose.yml"

rsync -rlvz --omit-dir-times --no-perms --no-owner --no-group \
  "${ROOT}/package.json" "${USER_NAME}@${HOST}:${DEST}/package.json"

ssh "${USER_NAME}@${HOST}" "cd ${DEST} && docker compose up -d app && docker compose restart app && sleep 4 && docker compose ps app"

echo "==> Quick deploy complete (v${DEPLOY_VERSION})."
echo "    Verify: curl -s http://${HOST}:3202/api/version"
