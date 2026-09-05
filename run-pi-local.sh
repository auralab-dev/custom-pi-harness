#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKING_CWD="$PWD"

wrapper_logging_enabled() {
  case "${PI_HARNESS_LOG:-false}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ -f "$ROOT/.env.local" ]]; then
  if wrapper_logging_enabled; then
    printf '[%s] [INFO] Loading optional local environment: %s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" "$ROOT/.env.local" >&2
  fi
  # .env.local is intentionally ignored by Git and is only sourced when the
  # operator created it locally. The Paperclip container does not copy it.
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

umask 077

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  wrapper_logging_enabled || return 0
  printf '[%s] [INFO] %s\n' "$(timestamp)" "$*" >&2
}

error() {
  printf '[%s] [ERROR] %s\n' "$(timestamp)" "$*" >&2
}

trap 'error "Launcher failed at line $LINENO: $BASH_COMMAND"' ERR

# shellcheck source=scripts/pi-arguments.sh
source "$ROOT/scripts/pi-arguments.sh"

# ---------------------------------------------------------------------------
# Pi config and per-agent harness state
# ---------------------------------------------------------------------------

agent_id="${PAPERCLIP_AGENT_ID:-local}"
agent_key="$(printf '%s' "$agent_id" | sed 's/[^A-Za-z0-9_-]/_/g')"
[[ -n "$agent_key" ]] || agent_key="local"

state_root="${PI_HARNESS_STATE_ROOT:-$ROOT/.pi/agents}"
if [[ "$state_root" != /* ]]; then
  state_root="$WORKING_CWD/$state_root"
fi
agent_state_dir="$state_root/$agent_key"
mkdir -p "$agent_state_dir"

if [[ -n "${PI_CODING_AGENT_DIR:-}" ]]; then
  pi_config_dir="$PI_CODING_AGENT_DIR"
  pi_config_source="Paperclip-provided"
else
  pi_config_dir="$HOME/.pi/agent"
  pi_config_source="global"
fi
mkdir -p "$pi_config_dir"

materialize_config() {
  local source="$1"
  local destination="$2"
  local temporary
  temporary="$(mktemp "${destination}.tmp.XXXXXX")"
  if cp "$source" "$temporary"; then
    mv -f "$temporary" "$destination"
  else
    rm -f "$temporary"
    return 1
  fi
}

export PI_HARNESS_MCP_ENTRY="$ROOT/node_modules/paperclip-mcp-server/dist/index.js"
export PI_HARNESS_MCP_CONFIG="$ROOT/.mcp.json"

# ---------------------------------------------------------------------------
# zvec
# ---------------------------------------------------------------------------

export ZVEC_GREP_HOME="$agent_state_dir/zvec-grep"
export ZVEC_GREP_MODEL_CACHE="$agent_state_dir/zvec-grep/models"
export ZVEC_GREP_MODE="auto"

# ---------------------------------------------------------------------------
# document conversion
# ---------------------------------------------------------------------------

export PI_DOCUMENT_CONVERT_CMD="$ROOT/pi-document-convert/cli.mjs"

export PI_DOCUMENT_CONVERT_PYTHON="${PI_DOCUMENT_CONVERT_PYTHON:-$ROOT/.pi/document-convert/venv/bin/python}"

# MCP artifacts deliberately remain project-relative so the model can pass a
# returned snapshot path to file_content_search. The agent id keeps concurrent
# Paperclip runs in the same workspace from colliding.
export PAPERCLIP_MCP_ARTIFACT_DIR="${PAPERCLIP_MCP_ARTIFACT_DIR:-.pi/paperclip-mcp-artifacts/$agent_key}"
export PAPERCLIP_MCP_TELEMETRY_FILE="${PAPERCLIP_MCP_TELEMETRY_FILE:-.pi/paperclip-mcp-telemetry-$agent_key.jsonl}"
export PI_MCP_CONFIG_MODE="${PI_MCP_CONFIG_MODE:-exclusive}"

# ---------------------------------------------------------------------------
# Validate packages
# ---------------------------------------------------------------------------

for pkg in \
  pi-web-access \
  pi-zvec-content \
  pi-document-convert \
  pi-workspace-boundary
do
  if [[ ! -f "$ROOT/$pkg/package.json" ]]; then
    error "Missing package:"
    error "  $ROOT/$pkg/package.json"
    exit 1
  fi
done

if [[ ! -f "$ROOT/node_modules/paperclip-mcp-server/package.json" ]]; then
  error "Paperclip MCP dependency not found:"
  error "  $ROOT/node_modules/paperclip-mcp-server/package.json"
  error ""
  error "Run ./install.sh first."
  exit 1
fi

if [[ ! -f "$PI_DOCUMENT_CONVERT_CMD" ]]; then
  error "Document converter CLI not found:"
  error "  $PI_DOCUMENT_CONVERT_CMD"
  exit 1
fi

if [[ ! -f "$PI_HARNESS_MCP_ENTRY" ]]; then
  error "Paperclip MCP build not found:"
  error "  $PI_HARNESS_MCP_ENTRY"
  error ""
  error "Run ./install.sh first."
  exit 1
fi

if [[ ! -f "$ROOT/.mcp.json" ]]; then
  error "Project MCP config not found:"
  error "  $ROOT/.mcp.json"
  exit 1
fi

# Extensions resolve their immutable profiles through Pi's effective config
# directory. Preserve global auth/models/settings and any Paperclip-managed
# models.json while atomically refreshing only harness-owned files.
for profile_file in web-search.json zvec-content.json document-convert.json; do
  if [[ -f "$ROOT/.pi/$profile_file" ]]; then
    materialize_config "$ROOT/.pi/$profile_file" "$pi_config_dir/$profile_file"
  fi
done

# In exclusive mode pi-mcp-adapter deliberately ignores --mcp-config and reads
# only the Pi-owned global config.
if [[ "${PI_MCP_CONFIG_MODE,,}" == "exclusive" ]]; then
  materialize_config "$PI_HARNESS_MCP_CONFIG" "$pi_config_dir/mcp.json"
fi

# Tool policy: fixed defaultTools=[read,find] + deny-list via PI_HARNESS_EXCLUDE_TOOLS.
# Pi defaults are [read,bash,edit,write] without find, so enforce our allow-list
# then filter by --exclude-tools. Extensions and paperclip_* MCP tools stay allowed.
if [[ -f "$pi_config_dir/settings.json" ]]; then
  if ! node -e 'const fs=require("node:fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));const want=["read","find"];const cur=s.defaultTools;if(JSON.stringify(cur)!==JSON.stringify(want)){s.defaultTools=want;fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n");console.error("[pi-harness] enforced defaultTools=[read,find]");}' "$pi_config_dir/settings.json"; then
    log "Could not normalize $pi_config_dir/settings.json, continuing with Pi defaults"
  fi
else
  printf '{\n  "defaultTools": [\n    "read",\n    "find"\n  ]\n}\n' > "$pi_config_dir/settings.json"
fi

if [[ ! -x "$PI_DOCUMENT_CONVERT_PYTHON" ]]; then
  error "Document converter Python venv not found:"
  error "  $PI_DOCUMENT_CONVERT_PYTHON"
  error ""
  error "Run ./install.sh first."
  exit 1
fi

# ---------------------------------------------------------------------------
# Local Pi executable
# ---------------------------------------------------------------------------

PI_BIN="$ROOT/node_modules/.bin/pi"

if [[ ! -x "$PI_BIN" ]]; then
  error "Local Pi executable not found:"
  error "  $PI_BIN"
  error ""
  error "Run ./install.sh first."
  exit 1
fi

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

log "Harness root: $ROOT"
log "Working directory: $WORKING_CWD"
log "Pi executable: $PI_BIN"
log "Pi config ($pi_config_source): $pi_config_dir"
log "Per-agent harness state: $agent_state_dir"
log "Paperclip MCP: $PI_HARNESS_MCP_ENTRY"
log "MCP config: $PI_HARNESS_MCP_CONFIG"

log "Document converter:"
log "  CLI: $PI_DOCUMENT_CONVERT_CMD"
log "  Python: $PI_DOCUMENT_CONVERT_PYTHON"

log "zvec:"
log "  home: $ZVEC_GREP_HOME"
log "  model cache: $ZVEC_GREP_MODEL_CACHE"
log "  mode: $ZVEC_GREP_MODE"

# ---------------------------------------------------------------------------
# Pi arguments
# ---------------------------------------------------------------------------

args=(
  --no-extensions
  --extension "$ROOT/pi-web-access/index.ts"
  --extension "$ROOT/pi-zvec-content/index.ts"
  --extension "$ROOT/pi-workspace-boundary/index.ts"
  --extension "$ROOT/node_modules/pi-mcp-adapter/index.ts"
  --mcp-config "$PI_HARNESS_MCP_CONFIG"
)

if [[ -f "$ROOT/node_modules/pi-session-trace/extensions/index.ts" ]]; then
  args+=(
    --extension "$ROOT/node_modules/pi-session-trace/extensions/index.ts"
  )
fi

if [[ -d "$ROOT/.pi/skills" ]]; then
  log "Loading project-local skills: $ROOT/.pi/skills"
  args+=(
    --skill "$ROOT/.pi/skills"
  )
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

exclude_tools="${PI_HARNESS_EXCLUDE_TOOLS:-bash,edit,write,grep,ls}"
log "Excluded Pi built-in tools: $exclude_tools"

filter_pi_tool_allowlists "$@"

# Paperclip's built-in-only --tools allowlist has been removed. Keep the
# exclusion last so adapter extraArgs cannot re-enable direct file or shell
# access, while extension and MCP tools remain active.
exec "$PI_BIN" "${args[@]}" "${PI_HARNESS_FORWARDED_ARGS[@]}" --exclude-tools "$exclude_tools"
