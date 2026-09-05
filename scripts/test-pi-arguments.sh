#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=pi-arguments.sh
source "$ROOT/scripts/pi-arguments.sh"

filter_pi_tool_allowlists \
  --mode json \
  --tools read,bash,edit,write,grep,find,ls \
  --session /tmp/session.jsonl \
  -t=read,find \
  -p \
  "prompt with spaces"

expected=(
  --mode json
  --session /tmp/session.jsonl
  -p
  "prompt with spaces"
)

[[ "${#PI_HARNESS_FORWARDED_ARGS[@]}" -eq "${#expected[@]}" ]]
for index in "${!expected[@]}"; do
  [[ "${PI_HARNESS_FORWARDED_ARGS[$index]}" == "${expected[$index]}" ]]
done

if filter_pi_tool_allowlists --tools 2>/dev/null; then
  printf 'missing --tools value should fail\n' >&2
  exit 1
fi
