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
# shellcheck source=deploy-env.sh
source "${ROOT}/scripts/deploy-env.sh"
load_deploy_env "${ROOT}"

HOST="${DEPLOY_HOST}"
USER_NAME="${DEPLOY_USER}"
DEST="${DEPLOY_DIR}"

if [ "$NO_BUMP" = false ]; then
    node "${ROOT}/scripts/bump-deploy-version.mjs"
    npm run build --prefix "${ROOT}"
fi

DEPLOY_VERSION="$(node -p "require('${ROOT}/package.json').version")"
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

ssh "${USER_NAME}@${HOST}" "cd ${DEST} && docker compose up -d app && sleep 3 && docker compose ps app"

echo "==> Quick deploy complete (v${DEPLOY_VERSION})."
echo "    Verify: curl -s http://${HOST}:3202/api/version"
