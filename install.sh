#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_PADDLE=0
PYTHON_BIN="${PYTHON_BIN:-}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] [INFO] %s\n' "$(timestamp)" "$*"
}

warn() {
  printf '[%s] [WARN] %s\n' "$(timestamp)" "$*" >&2
}

error() {
  printf '[%s] [ERROR] %s\n' "$(timestamp)" "$*" >&2
}

trap 'error "Installation failed at line $LINENO: $BASH_COMMAND"' ERR

for arg in "$@"; do
  case "$arg" in
    --paddle)
      INSTALL_PADDLE=1
      ;;
    *)
      error "Unknown option: $arg"
      exit 2
      ;;
  esac
done

log "Project root: $ROOT"
log "Paddle OCR: $([[ "$INSTALL_PADDLE" == "1" ]] && echo enabled || echo disabled)"

command -v pnpm >/dev/null 2>&1 || {
  error "pnpm is required but was not found in PATH"
  exit 1
}

command -v node >/dev/null 2>&1 || {
  error "node is required but was not found in PATH"
  exit 1
}

if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]] || ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  error "Python 3.11+ is required but was not found in PATH"
  error "Install Python 3.11+, or run with PYTHON_BIN=/path/to/python ./install.sh"
  exit 1
fi

PNPM_WORKSPACE="$ROOT/pnpm-workspace.yaml"

if [[ ! -f "$PNPM_WORKSPACE" ]]; then
  error "Missing pnpm workspace config: $PNPM_WORKSPACE"
  exit 1
fi

if [[ ! -d "$ROOT/pi-web-access" ]]; then
  error "Missing package directory: $ROOT/pi-web-access"
  exit 1
fi

if [[ ! -d "$ROOT/pi-zvec-content" ]]; then
  error "Missing package directory: $ROOT/pi-zvec-content"
  exit 1
fi

if [[ ! -d "$ROOT/pi-document-convert" ]]; then
  error "Missing package directory: $ROOT/pi-document-convert"
  exit 1
fi

if [[ ! -f "$ROOT/pi-document-convert/requirements.txt" ]]; then
  error "Missing requirements file: $ROOT/pi-document-convert/requirements.txt"
  exit 1
fi

if [[ "$INSTALL_PADDLE" == "1" && ! -f "$ROOT/pi-document-convert/requirements-paddle.txt" ]]; then
  error "Missing Paddle requirements file: $ROOT/pi-document-convert/requirements-paddle.txt"
  exit 1
fi

log "pnpm: $(pnpm --version)"
log "node: $(node --version)"
log "python: $("$PYTHON_BIN" --version 2>&1)"
log "Using pnpm workspace: $PNPM_WORKSPACE"

log "Installing Node workspace dependencies"
(
  cd "$ROOT"
  if grep -qE '^[[:space:]]+pi-playpen:' pnpm-lock.yaml; then
    pnpm install --frozen-lockfile
  else
    warn "pnpm-lock.yaml predates pi-playpen; refreshing it once"
    pnpm install --no-frozen-lockfile
  fi
)

VENV_ROOT="$ROOT/.pi/document-convert"
VENV="$VENV_ROOT/venv"
CONFIG="$ROOT/.pi/document-convert.json"

mkdir -p "$VENV_ROOT"

if [[ -x "$VENV/bin/python" ]]; then
  EXISTING_VERSION="$("$VENV/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  REQUESTED_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

  if [[ "$EXISTING_VERSION" != "$REQUESTED_VERSION" ]]; then
    warn "Existing venv uses Python $EXISTING_VERSION, requested Python is $REQUESTED_VERSION"
    log "Recreating virtual environment"
    rm -rf "$VENV"
  else
    log "Reusing Python virtual environment: $VENV"
  fi
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  log "Creating Python virtual environment: $VENV"
  "$PYTHON_BIN" -m venv "$VENV"
fi

PYTHON="$VENV/bin/python"

log "Virtualenv Python: $("$PYTHON" --version 2>&1)"

log "Upgrading pip, setuptools and wheel"
"$PYTHON" -m pip install --upgrade \
  pip \
  setuptools \
  wheel

log "Installing pi-document-convert native-text dependencies"
"$PYTHON" -m pip install \
  -r "$ROOT/pi-document-convert/requirements.txt"

if [[ "$INSTALL_PADDLE" == "1" ]]; then
  log "Installing PaddleOCR / PP-StructureV3 dependencies"
  "$PYTHON" -m pip install \
    -r "$ROOT/pi-document-convert/requirements-paddle.txt"

  log "Enabling Paddle OCR backend in $CONFIG"

  "$PYTHON" - "$CONFIG" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])

if path.exists():
    data = json.loads(path.read_text(encoding="utf-8"))
else:
    data = {}

pdf = data.setdefault("pdf", {})
pdf["ocrBackend"] = "paddle"

path.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY

  log "Paddle OCR backend enabled"
else
  if [[ -f "$CONFIG" ]]; then
    log "Leaving existing OCR backend configuration unchanged"
  fi
fi

log "Verifying PyMuPDF"
"$PYTHON" - <<'PY'
import pymupdf
print(f"PyMuPDF OK: {pymupdf.__doc__.splitlines()[0] if pymupdf.__doc__ else 'loaded'}")
PY

log "Verifying PyMuPDF4LLM"
"$PYTHON" - <<'PY'
import pymupdf4llm
print("PyMuPDF4LLM OK")
PY

if [[ "$INSTALL_PADDLE" == "1" ]]; then
  log "Verifying PaddleOCR"
  "$PYTHON" - <<'PY'
import paddleocr
print("PaddleOCR OK")
PY
fi

log "Installation complete"
log "Native-text PDFs use PyMuPDF4LLM"

if [[ "$INSTALL_PADDLE" == "1" ]]; then
  log "OCR backend: Paddle PP-StructureV3"
else
  warn "OCR is not being installed in this run"
  warn "Run ./install.sh --paddle to install and enable local Paddle OCR"
fi
