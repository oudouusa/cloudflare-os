#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config="${script_dir}/../litellm/config.yaml"
compat="${script_dir}/../litellm/cfos_deepseek_compat.py"

test "$(grep -c '^  - model_name:' "${config}")" -eq 1
grep -q '^  - model_name: deepseek-v4-flash$' "${config}"
grep -q '^      model: deepseek/deepseek-v4-flash$' "${config}"
grep -q '^      use_chat_completions_api: true$' "${config}"
grep -q '^      max_parallel_requests: 1$' "${config}"
grep -q '^      max_retries: 0$' "${config}"
grep -q '^  num_retries: 0$' "${config}"
grep -q '^  telemetry: false$' "${config}"
grep -q '^  turn_off_message_logging: true$' "${config}"
grep -q '^    - cfos_deepseek_compat.cfos_deepseek_compat$' "${config}"
test -f "${compat}"
test -f "${script_dir}/check-deepseek-stream-guard.py"
grep -q '^_install_empty_stream_choices_guard()$' "${compat}"

if grep -Eiq 'fallback|bedrock|gemini|nvidia|aws|zai' "${config}"; then
  printf 'FAIL forbidden provider or fallback route found in LiteLLM config\n' >&2
  exit 1
fi

printf 'PASS LiteLLM has one no-fallback, no-retry DeepSeek V4 Flash route\n'
