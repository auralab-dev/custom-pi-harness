#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] [INFO] %s\n' "$(timestamp)" "$*" >&2
}

error() {
  printf '[%s] [ERROR] %s\n' "$(timestamp)" "$*" >&2
}

trap 'error "Launcher failed at line $LINENO: $BASH_COMMAND"' ERR

# ---------------------------------------------------------------------------
# Project-local Pi state
# ---------------------------------------------------------------------------

export PI_CODING_AGENT_DIR="$ROOT/.pi"

# ---------------------------------------------------------------------------
# zvec
# ---------------------------------------------------------------------------

export ZVEC_GREP_HOME="$ROOT/.pi/zvec-grep"
export ZVEC_GREP_MODEL_CACHE="$ROOT/.pi/zvec-grep/models"
export ZVEC_GREP_MODE="auto"

# ---------------------------------------------------------------------------
# document conversion
# ---------------------------------------------------------------------------

export PI_DOCUMENT_CONVERT_CMD="$ROOT/pi-document-convert/cli.mjs"

export PI_DOCUMENT_CONVERT_PYTHON="${PI_DOCUMENT_CONVERT_PYTHON:-$ROOT/.pi/document-convert/venv/bin/python}"

# ---------------------------------------------------------------------------
# Validate packages
# ---------------------------------------------------------------------------

for pkg in \
  pi-web-access-main \
  pi-zvec-content \
  pi-document-convert
do
  if [[ ! -f "$ROOT/$pkg/package.json" ]]; then
    error "Missing package:"
    error "  $ROOT/$pkg/package.json"
    exit 1
  fi
done

if [[ ! -f "$PI_DOCUMENT_CONVERT_CMD" ]]; then
  error "Document converter CLI not found:"
  error "  $PI_DOCUMENT_CONVERT_CMD"
  exit 1
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

PI_BIN="$ROOT/pi-web-access-main/node_modules/.bin/pi"

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

log "Project root: $ROOT"
log "Pi executable: $PI_BIN"
log "Pi config: $PI_CODING_AGENT_DIR"

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
  --no-skills
)

if [[ -d "$ROOT/.pi/skills" ]]; then
  log "Loading project-local skills: $ROOT/.pi/skills"
  args+=(
    --skill "$ROOT/.pi/skills"
  )
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

cd "$ROOT"

exec "$PI_BIN" "${args[@]}" "$@"
