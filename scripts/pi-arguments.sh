#!/usr/bin/env bash

# Single-source tool policy: deny-list only via PI_HARNESS_EXCLUDE_TOOLS.
# Pi's --tools flag is a global allowlist covering built-in, extension, and MCP
# tools. Paperclip supplies a built-in-only list, so the harness must remove it
# before applying its own final denylist. Never add --tools here.
filter_pi_tool_allowlists() {
  PI_HARNESS_FORWARDED_ARGS=()

  while (( $# > 0 )); do
    case "$1" in
      --tools|-t)
        if (( $# < 2 )); then
          printf 'missing value for %s\n' "$1" >&2
          return 2
        fi
        shift 2
        ;;
      --tools=*|-t=*)
        shift
        ;;
      *)
        PI_HARNESS_FORWARDED_ARGS+=("$1")
        shift
        ;;
    esac
  done
}
