#!/usr/bin/env bash
set -euo pipefail

NO_BUMP=false
for arg in "$@"; do
    case "$arg" in
        --no-bump) NO_BUMP=true ;;
    esac
done

HOST="${DEPLOY_HOST:-192.168.1.50}"
USER="${DEPLOY_USER:-patricktd}"
DEST="${DEPLOY_DIR:-/opt/matter-cameras}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$NO_BUMP" = false ]; then
    node "${ROOT}/scripts/bump-deploy-version.mjs"
    npm run build --prefix "${ROOT}"
fi

DEPLOY_VERSION="$(node -p "require('${ROOT}/package.json').version")"
echo "==> Deploy MatterCameras v${DEPLOY_VERSION} → ${USER}@${HOST}:${DEST}"

rsync -rlvz --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude data/matter-storage \
  --exclude data/cameras.json \
  --exclude '*.expect' \
  --exclude .env \
  "${ROOT}/" "${USER}@${HOST}:${DEST}/"

echo "==> Building and starting containers..."
ssh "${USER}@${HOST}" bash -s <<EOF
set -euo pipefail
cd "${DEST}"
mkdir -p data
[ -f data/cameras.json ] || cp data/cameras.json.example data/cameras.json 2>/dev/null || echo '{"cameras":[]}' > data/cameras.json
docker compose down 2>/dev/null || true
docker compose up --build -d
docker compose ps
echo ""
echo "Web UI:  http://${HOST}:3202"
echo "go2rtc:  http://${HOST}:3203"
echo "Matter:  ${HOST}:5550"
EOF

echo "==> Deploy complete (v${DEPLOY_VERSION})."
echo "    Verify: curl -s http://${HOST}:3202/api/version"
