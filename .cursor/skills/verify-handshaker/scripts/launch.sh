#!/usr/bin/env bash
# Start tauri-driver and the Handshaker debug binary. Prints a ready line.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/hsdrv.py" launch
