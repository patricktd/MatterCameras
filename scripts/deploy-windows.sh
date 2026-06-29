#!/usr/bin/env bash
# Windows deploy: build, file sync, remote Docker — one SSH multiplex session.
set -euo pipefail

MODE="${1:?full|quick}"
shift || true

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
# Multiplexing disabled on Git Bash; mux_start/stop are no-ops there.
deploy_ssh_mux_start
trap 'deploy_ssh_mux_stop' EXIT

if [ ! -d "${ROOT}/dist" ]; then
    echo "==> Building (dist/ missing)..."
    npm run build --prefix "${ROOT_NODE}"
fi

bash "${ROOT}/scripts/deploy-rsync-windows.sh" "${MODE}"
bash "${ROOT}/scripts/deploy-remote.sh" "${MODE}"

case "${MODE}" in
    full) echo "==> Deploy complete." ;;
    quick) echo "==> Quick deploy complete." ;;
esac
