#!/usr/bin/env bash

# Pi's --tools flag is a global allowlist covering built-in, extension, and MCP
# tools. Paperclip supplies a built-in-only list, so the harness removes it and
# relies on defaultTools plus pi-playpen for the seven built-ins. This keeps
# extension and MCP tools visible while Playpen enforces filesystem scope.
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
