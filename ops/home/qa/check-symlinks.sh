#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${1:-$(cd -- "${script_dir}/../../.." && pwd)}"
actual="$(mktemp)"
trap 'rm -f -- "${actual}"' EXIT

cd -- "${repo_root}"
find . -name .git -prune -o -name node_modules -prune -o -type l \
  -printf '%P -> %l\n' | LC_ALL=C sort >"${actual}"

diff -u -- "${script_dir}/symlinks.expected" "${actual}"

while IFS= read -r record; do
  path="${record%% -> *}"
  test -L "${path}"
  test -e "${path}"
done <"${script_dir}/symlinks.expected"

printf 'PASS all 23 expected symlinks and targets are intact\n'
