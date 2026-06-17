# shellcheck shell=bash
# Shared deploy target config. Copy deploy.env.example → deploy.env (gitignored).
load_deploy_env() {
    local root="$1"
    if [[ -f "${root}/deploy.env" ]]; then
        set -a
        # shellcheck source=/dev/null
        source "${root}/deploy.env"
        set +a
    fi
    : "${DEPLOY_HOST:?Set DEPLOY_HOST in deploy.env (copy deploy.env.example)}"
    : "${DEPLOY_USER:?Set DEPLOY_USER in deploy.env}"
    : "${DEPLOY_DIR:?Set DEPLOY_DIR in deploy.env}"
}
