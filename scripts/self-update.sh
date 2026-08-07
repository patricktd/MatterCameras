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

echo "==> Installing dependencies and building dist/"
npm ci
npm run build

COMPOSE_ARGS=(-f docker-compose.yml)

echo "==> Rebuilding and restarting containers"
docker compose "${COMPOSE_ARGS[@]}" build app go2rtc
docker compose "${COMPOSE_ARGS[@]}" up -d
docker compose "${COMPOSE_ARGS[@]}" restart app

echo "==> Self-update complete"
