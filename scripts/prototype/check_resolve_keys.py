#!/usr/bin/env python3
"""Fail unless the only `envRevision}` template is `resolveKey.ts`.

The three hand-rolled templates (CallPanel, HttpPanel, CollectionOverview)
are the hole. One builder owns the template.

    python3 scripts/prototype/check_resolve_keys.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = "src/features/workflow/resolveKey.ts"


def sites() -> list[str]:
    found = []
    src = ROOT / "src"
    for path in src.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if "envRevision}" in line and "`" in line:
                found.append(f"{path.relative_to(ROOT)}:{lineno}")
    return found


def main() -> int:
    found = sites()
    ok = len(found) == 1 and found[0].startswith(ALLOWED + ":")
    print(f"hand_rolled_resolve_keys={len(found)}")
    for site in found:
        print(f"  {site}")
    if ok:
        print(f"only_builder={ALLOWED}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
