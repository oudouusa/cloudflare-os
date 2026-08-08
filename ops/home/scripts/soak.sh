#!/usr/bin/env bash
set -euo pipefail

duration_seconds="${CFOS_SOAK_SECONDS:-720}"
interval_seconds="${CFOS_SOAK_INTERVAL_SECONDS:-30}"
if [[ ! "${duration_seconds}" =~ ^[0-9]+$ || ! "${interval_seconds}" =~ ^[0-9]+$ ||
      "${duration_seconds}" -lt 1 || "${interval_seconds}" -lt 1 ]]; then
  printf 'Soak durations must be positive integers.\n' >&2
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
compose=(docker compose --env-file "${env_file}" -f "${home_dir}/compose.yaml")

for service in litellm cloudflare-os; do
  container_id="$("${compose[@]}" ps -q "${service}")"
  test -n "${container_id}"
  case "${service}" in
    litellm)
      initial_litellm_container_id="${container_id}"
      initial_litellm_restarts="$(docker inspect -f '{{.RestartCount}}' "${container_id}")"
      ;;
    cloudflare-os)
      initial_cloudflare_os_container_id="${container_id}"
      initial_cloudflare_os_restarts="$(docker inspect -f '{{.RestartCount}}' "${container_id}")"
      ;;
  esac
done

deadline=$((SECONDS + duration_seconds))
while (( SECONDS < deadline )); do
  for service in litellm cloudflare-os; do
    container_id="$("${compose[@]}" ps -q "${service}")"
    running="$(docker inspect -f '{{.State.Running}}' "${container_id}")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}")"
    restarts="$(docker inspect -f '{{.RestartCount}}' "${container_id}")"
    case "${service}" in
      litellm)
        initial_container_id="${initial_litellm_container_id}"
        initial_restarts="${initial_litellm_restarts}"
        ;;
      cloudflare-os)
        initial_container_id="${initial_cloudflare_os_container_id}"
        initial_restarts="${initial_cloudflare_os_restarts}"
        ;;
    esac
    same_container=false
    if [[ "${container_id}" == "${initial_container_id}" ]]; then same_container=true; fi
    if [[ "${same_container}" != true ||
          "${running}" != true || "${health}" != healthy ||
          "${restarts}" != "${initial_restarts}" ]]; then
      printf 'FAIL %s same_container=%s running=%s health=%s restarts=%s initial=%s\n' \
        "${service}" "${same_container}" "${running}" "${health}" "${restarts}" \
        "${initial_restarts}" >&2
      exit 1
    fi
  done
  sleep_for="${interval_seconds}"
  if (( SECONDS + sleep_for > deadline )); then sleep_for=$((deadline - SECONDS)); fi
  if (( sleep_for > 0 )); then sleep "${sleep_for}"; fi
done

printf 'PASS %s-second health/restart soak completed without a restart\n' "${duration_seconds}"
