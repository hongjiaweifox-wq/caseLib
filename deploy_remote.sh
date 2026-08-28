#!/usr/bin/env bash
# Deploy / start caseLib on the target VM.
# Usage (on the VM, from the caseLib directory or its parent):
#   bash deploy_remote.sh
# Or after git clone:
#   cd ~/apps/caseLib && bash deploy_remote.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(cd "$ROOT/.." && pwd)"
PORT="${PORT:-8780}"
HOST="${HOST:-0.0.0.0}"
PID_FILE="${ROOT}/.caseLib.pid"
LOG_FILE="${ROOT}/.caseLib.log"
MOD_NAME="$(basename "$ROOT")"

cd "$PARENT"

pick_python() {
  if command -v uv >/dev/null 2>&1; then
    local py
    py="$(uv python find 3.12 2>/dev/null || uv python find 3.11 2>/dev/null || true)"
    if [[ -n "${py}" ]]; then
      echo "$py"
      return
    fi
  fi
  command -v python3
}

PY="$(pick_python)"
if [[ -z "${PY}" ]]; then
  echo "python3 not found" >&2
  exit 1
fi

echo "Using Python: $PY"

if [[ -f "$PID_FILE" ]]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "Stopping old process pid=$old"
    kill "$old" 2>/dev/null || true
    sleep 0.5
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -ti ":$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi

pkill -f "python3 -m caseLib" 2>/dev/null || true
pkill -f "${MOD_NAME}/__main__.py" 2>/dev/null || true
sleep 0.3

nohup "$PY" -u -m "$MOD_NAME" "$HOST" "$PORT" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 1

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-172.16.239.92}"

echo "caseLib started pid=$(cat "$PID_FILE")"
echo "  local:  http://127.0.0.1:${PORT}/"
echo "  lan:    http://${IP}:${PORT}/"
echo "  log:    $LOG_FILE"
curl -fsS "http://127.0.0.1:${PORT}/api/health" || echo "(health check failed — see log)"
echo
