#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/setup.sh [--start]

Install project dependencies and build Folio OCR on Linux or macOS.
Requires Node.js 22+ with npm and internet access. Installs uv if missing;
uv automatically downloads Python 3.12 when needed.

  --start  Start the app at http://127.0.0.1:8000 after setup
  --help   Show this help
EOF
}

start=false
for argument in "$@"; do
  case "$argument" in
    --start) start=true ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; usage >&2; exit 1 ;;
  esac
done

cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Install Node.js 22+ (including npm) from https://nodejs.org/, reopen your terminal, and retry.' >&2
  exit 1
fi
if ! node -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)'; then
  echo 'Node.js 22 or newer is required. Upgrade Node.js and retry.' >&2
  exit 1
fi

uv_bin="$(command -v uv || true)"
if [[ -z "$uv_bin" && -x "$HOME/.local/bin/uv" ]]; then
  uv_bin="$HOME/.local/bin/uv"
fi
if [[ -z "$uv_bin" ]]; then
  echo 'Installing uv from https://astral.sh/uv/install.sh ...'
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  if command -v curl >/dev/null; then
    curl --fail --show-error --silent --location https://astral.sh/uv/install.sh -o "$installer"
  elif command -v wget >/dev/null; then
    wget -q https://astral.sh/uv/install.sh -O "$installer"
  else
    echo 'Install curl or wget, or install uv from https://docs.astral.sh/uv/getting-started/installation/.' >&2
    exit 1
  fi
  UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$installer"
  uv_bin="$HOME/.local/bin/uv"
fi

echo 'Installing Python dependencies from uv.lock ...'
"$uv_bin" sync --locked --dev
echo 'Installing frontend dependencies from package-lock.json ...'
npm --prefix frontend ci --include=dev
echo 'Building the frontend ...'
npm --prefix frontend run build

echo
echo 'Setup complete. OCR models download when first needed.'
if [[ "$start" == true ]]; then
  echo 'Starting http://127.0.0.1:8000 - press Ctrl+C to stop.'
  "$uv_bin" run --no-sync python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
else
  echo 'From the project directory, start the app with:'
  printf '  %q run --no-sync python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000\n' "$uv_bin"
fi
