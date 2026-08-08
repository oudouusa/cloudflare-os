#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s RESTORED_DOCKER_VOLUME_NAME\n' "$0" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
home_dir="$(cd -- "${script_dir}/.." && pwd)"
env_file="${CFOS_ENV_FILE:-${home_dir}/.env}"
volume_name="$1"

if [[ ! -f "${env_file}" ]]; then
  printf 'Missing %s.\n' "${env_file}" >&2
  exit 1
fi
mode="$(stat -c '%a' "${env_file}")"
if (( 10#${mode} % 100 > 0 )); then
  printf 'Refusing to continue: %s must not grant group/other permissions (current %s).\n' \
    "${env_file}" "${mode}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a
live_volume="${CFOS_WRANGLER_VOLUME:-cloudflare-os-home-wrangler}"
if [[ "${volume_name}" == "${live_volume}" ]]; then
  printf 'Refusing to attach the live volume to the restore verification stack.\n' >&2
  exit 1
fi
docker volume inspect "${volume_name}" >/dev/null
docker run --rm --user 1000:1000 \
  --volume "${volume_name}:/restore:ro" \
  --entrypoint test \
  "${CFOS_IMAGE:-cloudflare-os-home:local}" \
  -f /restore/.cfos-restore-complete || {
    printf 'Refusing volume without a completed-restore marker: %s\n' "${volume_name}" >&2
    exit 1
  }
export CFOS_RESTORE_VOLUME="${volume_name}"

docker compose \
  --env-file "${env_file}" \
  -f "${home_dir}/compose.yaml" \
  -f "${home_dir}/qa/compose.mock.yaml" \
  -f "${home_dir}/compose.restore.yaml" \
  up -d --no-build

printf 'Restore verification stack started with a no-cost mock model.\n'
printf 'Open http://127.0.0.1:%s and verify the owner account, chat, and Gadget.\n' \
  "${CFOS_RESTORE_HOST_PORT:-18877}"
printf 'The verification containers and volume are intentionally retained until explicit cleanup.\n'
