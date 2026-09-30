#!/usr/bin/env bash
#
# Pull a GitHub release (or main) and rebuild Docker services on the host.
# Invoked from the Web UI when MATTER_CAMERAS_SELF_UPDATE_ROOT is set.
#
# Requires: git checkout of MatterCameras, Node.js/npm on PATH, docker compose,
# and /var/run/docker.sock (mounted by docker-compose.yml).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

TARGET="${1:-}"
echo "==> Matter Cameras Bridge self-update (${ROOT})"

if [[ -f /.dockerenv && "${MATTER_CAMERAS_SELF_UPDATE_HELPER:-0}" != "1" ]]; then
  CONTAINER_NAME="${MATTER_CAMERAS_CONTAINER_NAME:-matter_cameras}"
  UPDATER_NAME="${CONTAINER_NAME}_updater"
  HOST_ROOT="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/project"}}{{.Source}}{{end}}{{end}}' "${CONTAINER_NAME}")"
  IMAGE_ID="$(docker inspect --format '{{.Image}}' "${CONTAINER_NAME}")"

  if [[ -z "${HOST_ROOT}" || -z "${IMAGE_ID}" ]]; then
    echo "ERROR: Could not resolve the host checkout or app image from ${CONTAINER_NAME}." >&2
    exit 1
  fi
  if docker inspect "${UPDATER_NAME}" >/dev/null 2>&1; then
    echo "ERROR: An update helper is already running (${UPDATER_NAME})." >&2
    exit 1
  fi

  echo "==> Starting host-path update helper (${HOST_ROOT})"
  docker run --detach --rm \
    --name "${UPDATER_NAME}" \
    -e MATTER_CAMERAS_SELF_UPDATE_HELPER=1 \
    -v "${HOST_ROOT}:${HOST_ROOT}" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -w "${HOST_ROOT}" \
    "${IMAGE_ID}" \
    bash -c 'exec bash scripts/self-update.sh "$1" >> data/self-update.log 2>&1' \
    _ "${TARGET}" >/dev/null
  echo "==> Update helper started"
  exit 0
fi

if [[ ! -d .git ]]; then
  echo "ERROR: .git not found — clone https://github.com/patricktd/MatterCameras to use self-update." >&2
  exit 1
fi

git_safe() {
  git -c safe.directory="${ROOT}" "$@"
}

git_safe fetch --tags origin

if [[ -n "${TARGET}" ]]; then
  TAG="v${TARGET#v}"
  echo "==> Checking out ${TAG}"
  git_safe checkout -f "${TAG}"
else
  echo "==> Fast-forwarding main"
  git_safe pull --ff-only origin main
fi

# Bash keeps the originally-opened script inode open. Without a re-exec, the
# build/restart steps below would still run the PREVIOUS revision's script —
# so fixes to self-update.sh would never apply to the update that installs them.
if [[ "${MATTER_CAMERAS_SELF_UPDATE_REEXEC:-0}" != "1" ]]; then
  echo "==> Re-executing self-update.sh from checked-out revision"
  export MATTER_CAMERAS_SELF_UPDATE_REEXEC=1
  exec bash "${ROOT}/scripts/self-update.sh" "${TARGET}"
fi

echo "==> Installing dependencies and building dist/"
npm ci --include=dev
npm run build

COMPOSE_ARGS=(-f docker-compose.yml)

echo "==> Rebuilding images"
docker compose "${COMPOSE_ARGS[@]}" build app go2rtc

# Recreate containers from the freshly built images. `up -d` is idempotent and
# recreates the app/go2rtc containers; a separate `restart app` is unnecessary
# and could race the recreate step, leaving the bridge stopped.
echo "==> Recreating and starting containers"
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans

# Verify the app container is running AND the Web UI answers with the target
# version. Docker "running" alone is not enough — Node may still be booting.
# (Image has wget/node, not curl.)
CONTAINER_NAME="${MATTER_CAMERAS_CONTAINER_NAME:-matter_cameras}"
WEB_PORT="${WEB_PORT:-3202}"
EXPECTED_VERSION="${TARGET#v}"
echo "==> Waiting for ${CONTAINER_NAME} (and /api/version) to come up"
for attempt in $(seq 1 60); do
  STATE="$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo missing)"
  if [[ "${STATE}" == "running" ]]; then
    LIVE_VERSION="$(wget -qO- --timeout=2 "http://127.0.0.1:${WEB_PORT}/api/version" 2>/dev/null \
      | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' || true)"
    if [[ -z "${EXPECTED_VERSION}" || "${LIVE_VERSION}" == "${EXPECTED_VERSION}" ]]; then
      echo "==> ${CONTAINER_NAME} is running (version=${LIVE_VERSION:-unknown})"
      break
    fi
    echo "    … running but version is '${LIVE_VERSION:-unknown}' (want '${EXPECTED_VERSION}')"
  fi
  if [[ "${attempt}" == "60" ]]; then
    echo "ERROR: ${CONTAINER_NAME} did not become ready after update (state=${STATE}, version=${LIVE_VERSION:-unknown})." >&2
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50 app >&2 || true
    exit 1
  fi
  sleep 2
done

echo "==> Self-update complete"
