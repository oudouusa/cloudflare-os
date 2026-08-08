#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s ABSOLUTE_BACKUP_DIRECTORY NEW_DOCKER_VOLUME_NAME\n' "$0" >&2
  exit 2
fi

backup_dir="${1%/}"
new_volume="$2"
if [[ "${backup_dir}" != /* || "${backup_dir}" == / ]]; then
  printf 'Backup directory must be an explicit absolute directory below /.\n' >&2
  exit 2
fi
if [[ ! "${new_volume}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]]; then
  printf 'Invalid Docker volume name.\n' >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
home_dir="$(cd -- "${script_dir}/.." && pwd)"
env_file="${CFOS_ENV_FILE:-${home_dir}/.env}"
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
image_name="${CFOS_IMAGE:-cloudflare-os-home:local}"

if [[ "${new_volume}" == "${live_volume}" ]]; then
  printf 'Refusing to restore into the live volume %s.\n' "${live_volume}" >&2
  exit 1
fi
if docker volume inspect "${new_volume}" >/dev/null 2>&1; then
  printf 'Refusing to overwrite existing volume %s.\n' "${new_volume}" >&2
  exit 1
fi

for file in wrangler.tar metadata.txt SHA256SUMS; do
  test -f "${backup_dir}/${file}" || {
    printf 'Missing backup file: %s\n' "${backup_dir}/${file}" >&2
    exit 1
  }
done
(
  cd -- "${backup_dir}"
  sha256sum -c SHA256SUMS
)

docker volume create \
  --label cloudflare-os-home.restore-verification=true \
  --label "cloudflare-os-home.source-backup=$(basename -- "${backup_dir}")" \
  "${new_volume}" >/dev/null

restore_ok=false
cleanup_failed_restore() {
  if [[ "${restore_ok}" != true ]]; then
    printf 'Restore failed; the new volume was left in place for inspection: %s\n' "${new_volume}" >&2
  fi
}
trap cleanup_failed_restore EXIT

docker run --rm -i \
  --user 0:0 \
  --volume "${new_volume}:/restore" \
  "${image_name}" \
  sh -c 'test -z "$(find /restore -mindepth 1 -maxdepth 1 -print -quit)" && tar --numeric-owner -xpf - -C /restore && touch /restore/.cfos-restore-complete && chown 1000:1000 /restore/.cfos-restore-complete' \
  <"${backup_dir}/wrangler.tar"

restore_ok=true
trap - EXIT
printf 'Restore complete in new verification volume: %s\n' "${new_volume}"
printf 'The volume was intentionally retained and has not been attached to the live service.\n'
