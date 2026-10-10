#!/usr/bin/env bash
# Read-only health check of the window started by launch.sh. Does not click.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/hsdrv.py" doctor
