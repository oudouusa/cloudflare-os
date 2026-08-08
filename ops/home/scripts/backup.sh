#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s ABSOLUTE_LINUX_BACKUP_ROOT\n' "$0" >&2
  exit 2
fi

backup_root="$1"
if [[ "${backup_root}" != /* || "${backup_root}" == / || "${backup_root}" == /mnt/* ]]; then
  printf 'Backup root must be an explicit Linux-side absolute directory below / (not / itself or /mnt).\n' >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
home_dir="$(cd -- "${script_dir}/.." && pwd)"
repo_root="$(cd -- "${home_dir}/../.." && pwd)"
compose_file="${home_dir}/compose.yaml"
env_file="${CFOS_ENV_FILE:-${home_dir}/.env}"

if [[ ! -f "${env_file}" ]]; then
  printf 'Missing %s; create it from .env.example and chmod 600.\n' "${env_file}" >&2
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

volume_name="${CFOS_WRANGLER_VOLUME:-cloudflare-os-home-wrangler}"
image_name="${CFOS_IMAGE:-cloudflare-os-home:local}"
docker volume inspect "${volume_name}" >/dev/null

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_root%/}/${timestamp}"
mkdir -p -- "${destination}"
chmod 700 -- "${backup_root}" "${destination}"

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")
container_id="$("${compose[@]}" ps -q cloudflare-os)"
was_running=false
if [[ -n "${container_id}" && "$(docker inspect -f '{{.State.Running}}' "${container_id}")" == true ]]; then
  was_running=true
fi

restart_if_needed() {
  if [[ "${was_running}" == true ]]; then
    "${compose[@]}" up -d --no-deps cloudflare-os >/dev/null || true
  fi
}
trap restart_if_needed EXIT

if [[ "${was_running}" == true ]]; then
  "${compose[@]}" stop cloudflare-os
  stop_exit_code="$(docker inspect -f '{{.State.ExitCode}}' "${container_id}")"
  stop_oom_killed="$(docker inspect -f '{{.State.OOMKilled}}' "${container_id}")"
  if [[ "${stop_exit_code}" == 137 || "${stop_oom_killed}" == true ]]; then
    printf 'Refusing backup: Cloudflare OS did not stop cleanly (exit=%s, oom=%s).\n' \
      "${stop_exit_code}" "${stop_oom_killed}" >&2
    exit 1
  fi
fi

docker run --rm \
  --volume "${volume_name}:/source:ro" \
  --volume "${destination}:/backup" \
  "${image_name}" \
  sh -c 'cd /source && tar --numeric-owner -cpf /backup/wrangler.tar .'

upstream_sha="$(git -C "${repo_root}" rev-parse upstream/main)"
home_sha="$(git -C "${repo_root}" rev-parse HEAD)"
dirty=false
if [[ -n "$(git -C "${repo_root}" status --porcelain)" ]]; then dirty=true; fi
image_id="$(docker image inspect -f '{{.Id}}' "${image_name}")"
compose_hash="$("${compose[@]}" config --no-interpolate | sha256sum | cut -d' ' -f1)"

{
  printf 'timestamp_utc=%s\n' "${timestamp}"
  printf 'upstream_sha=%s\n' "${upstream_sha}"
  printf 'home_sha=%s\n' "${home_sha}"
  printf 'worktree_dirty=%s\n' "${dirty}"
  printf 'image_name=%s\n' "${image_name}"
  printf 'image_id=%s\n' "${image_id}"
  printf 'compose_hash=%s\n' "${compose_hash}"
  printf 'source_volume=%s\n' "${volume_name}"
} >"${destination}/metadata.txt"

(
  cd -- "${destination}"
  sha256sum wrangler.tar metadata.txt >SHA256SUMS
  chmod 600 wrangler.tar metadata.txt SHA256SUMS
)

trap - EXIT
restart_if_needed

printf 'Backup complete: %s\n' "${destination}"
printf 'WARNING: the archive may contain accounts, chats, model credentials, and other private state.\n'
