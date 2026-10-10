#!/usr/bin/env bash
# Stop the recorded driver session and keep its evidence directory.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/hsdrv.py" cleanup
