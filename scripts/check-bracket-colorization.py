#!/usr/bin/env python3
"""Lock bracket colorization to the language config in src/lib/monaco.ts.

`a667f2a` set `bracketPairColorization` on the editor options, in this same
file. `0ba7bfa` removed that option and set `colorizedBracketPairs: []` on
the language. A scan that only allows the strings inside monaco.ts stays
green on `a667f2a`, so this check rejects `bracketPairColorization` anywhere
under src. `colorizedBracketPairs` may appear only in src/lib/monaco.ts, and
that file must still contain it.

    python3 scripts/check-bracket-colorization.py [--root DIR]
"""

from __future__ import annotations

import sys
from pathlib import Path

EDITOR_OPTION = "bracketPairColorization"
LANGUAGE_OPTION = "colorizedBracketPairs"
ALLOWED = "src/lib/monaco.ts"


def scan(root: Path) -> tuple[list[str], bool]:
    hits: list[str] = []
    language_present = False
    src = root / "src"
    if not src.is_dir():
        return [f"{ALLOWED}: missing {LANGUAGE_OPTION}"], False
    for path in sorted(src.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        rel = path.relative_to(root).as_posix()
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if EDITOR_OPTION in line:
                hits.append(f"{rel}:{lineno}: {EDITOR_OPTION}")
            if LANGUAGE_OPTION in line:
                if rel == ALLOWED:
                    language_present = True
                else:
                    hits.append(f"{rel}:{lineno}: {LANGUAGE_OPTION}")
    if not language_present:
        hits.append(f"{ALLOWED}: missing {LANGUAGE_OPTION}")
    return hits, language_present


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    args = sys.argv[1:]
    if args:
        if args[:1] != ["--root"] or len(args) != 2:
            print("usage: check-bracket-colorization.py [--root DIR]", file=sys.stderr)
            return 2
        root = Path(args[1])
    hits, language_present = scan(root)
    editor_hits = sum(1 for hit in hits if EDITOR_OPTION in hit)
    print(f"{EDITOR_OPTION}={editor_hits}")
    if language_present:
        print(f"{LANGUAGE_OPTION}={ALLOWED}")
    else:
        print(f"{LANGUAGE_OPTION}=missing")
    for hit in hits:
        print(f"  {hit}")
    return 0 if not hits and language_present else 1


if __name__ == "__main__":
    sys.exit(main())
