#!/usr/bin/env python3
"""Fail when prose UI strings outside src/lib/messages.ts grow.

The prose set is ``prose_hits()`` in ``scripts/quantify-agent-pitfalls.py``.
A single kebab or snake token is not prose. The baseline is the hit count in
``scripts/prose-ui.baseline``. A smaller count passes. A larger count fails.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = Path(__file__).resolve().parent / "prose-ui.baseline"
SCANNER_PATH = Path(__file__).resolve().parent / "quantify-agent-pitfalls.py"


def load_scanner():
    spec = importlib.util.spec_from_file_location("quantify_agent_pitfalls", SCANNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCANNER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_baseline() -> int:
    text = BASELINE_PATH.read_text(encoding="utf-8").strip()
    if not text.isdecimal():
        raise ValueError(f"{BASELINE_PATH.relative_to(ROOT)} is not a hit count")
    return int(text)


def main() -> int:
    try:
        baseline = read_baseline()
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    prose = load_scanner().prose_hits()
    count = len(prose)
    if count > baseline:
        print(
            f"error: {count} prose UI strings, baseline is {baseline}. "
            "Move new user-facing prose into src/lib/messages.ts."
        )
        for hit in prose:
            print(f"- {hit}")
        return 1
    print(f"prose UI strings: {count} (baseline {baseline})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
