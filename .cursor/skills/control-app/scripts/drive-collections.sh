#!/usr/bin/env bash
# Create a collection from the sidebar and record the window plus the JSON file.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/hsdrv.py" drive-collections
