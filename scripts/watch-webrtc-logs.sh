#!/usr/bin/env bash
# Tail Matter + go2rtc logs filtered for WebRTC live-view tests.
# Usage: ./scripts/watch-webrtc-logs.sh [since]
# Example: ./scripts/watch-webrtc-logs.sh 2m
#
# Requires deploy.env (copy deploy.env.example).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy-env.sh
source "${ROOT}/scripts/deploy-env.sh"
load_deploy_env "${ROOT}"

HOST="${DEPLOY_HOST}"
USER_NAME="${DEPLOY_USER}"
SINCE="${1:-1m}"

echo "=== WebRTC log monitor → ${USER_NAME}@${HOST} (since ${SINCE}) ==="
echo "=== Press Ctrl+C to stop ==="
echo ""

ssh "${USER_NAME}@${HOST}" bash -s <<EOF
echo "[APP] Matter signaling (ProvideOffer, answer, ICE)"
docker logs -f --since ${SINCE} matter_cameras 2>&1 \
  | sed -u 's/^/[APP] /' \
  | grep --line-buffered -E 'ProvideOffer|Filtered hub|go2rtc answer|WebRTC answer|ICE candidates|Replacing|Recycled|failed|error' &
echo "[ICE] go2rtc ICE/DTLS"
docker logs -f --since ${SINCE} matter_go2rtc 2>&1 \
  | sed -u 's/^/[ICE] /' \
  | grep --line-buffered -E 'ICE connection|Handshake Completed|nominated: true|nominated: false|failed|error response|disconnected|connected' &
wait
EOF
