#!/usr/bin/env python3
"""Diff the generated var tables against the Rust sources.

Successor of scripts/prototype/check_mirrors.py. Exit 1 when Monaco's rules miss
a core `{{var}}` or a name set disagrees. Exit 2 when dropping FieldMask from
the Rust set would not diverge it from the generated names
(`synthetic_wkt_drift_detected` is false). Exit 0 when the corpus misses 0,
the sets match, and that self-test fires.

Not part of `pnpm lint`. Regenerate with export-bindings; this script only compares.

    python3 scripts/check_var_tables.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SAMPLES = [
    "{{host}}",
    "{{uri-root}}",
    "{{user.name}}",
    "{{a/b}}",
    "{{$guid}}",
    "{{$unixMs}}",
    "{{123}}",
    "{{ключ}}",
    "{{a b}}",
    "{{notes-api-root}}",
]

OLD_IDENT = "[a-zA-Z_][a-zA-Z0-9_\\-]*"


def rust_var_pattern() -> str:
    text = (ROOT / "crates/handshaker-core/src/vars/mod.rs").read_text()
    match = re.search(r'pub const VAR_PATTERN: &str = r"(.*)";', text)
    if not match:
        raise SystemExit("VAR_PATTERN not found")
    return match.group(1)


def classify_names(text: str) -> set[str]:
    start = text.find("pub(crate) fn classify(")
    if start < 0:
        raise SystemExit("fn classify not found")
    end = text.find("\n}", start)
    body = text[start:end]
    return set(re.findall(r'"(google\.protobuf\.[A-Za-z0-9]+)"\s*=>', body))


def builtin_names(text: str, marker: str) -> set[str]:
    match = re.search(marker + r"(.*?)\]", text, re.S)
    if not match:
        raise SystemExit(f"builtin list not found: {marker}")
    return set(re.findall(r'"(\$[A-Za-z0-9]+)"', match.group(1)))


def gen_wkt_names(text: str) -> set[str]:
    return set(re.findall(r'"(google\.protobuf\.[A-Za-z0-9]+)"\s*:', text))


def monaco_accepts(sample: str, monaco: str, pattern: str) -> bool:
    if OLD_IDENT in monaco:
        user = re.compile(r"\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}")
        dyn = re.compile(r"\{\{\$[a-zA-Z][a-zA-Z0-9_\-]*\}\}")
        return bool(user.search(sample) or dyn.search(sample))
    dynamic = pattern.replace(r"\{\{(", r"\{\{\$(", 1)
    return bool(re.search(dynamic, sample) or re.search(pattern, sample))


def main() -> int:
    pattern = rust_var_pattern()
    grammar = (ROOT / "src/features/vars/varGrammar.gen.ts").read_text()
    encoded = pattern.replace("\\", "\\\\")
    pattern_equal = f'"{encoded}"' in grammar
    monaco = (ROOT / "src/lib/monaco.ts").read_text()
    core = re.compile(pattern)
    bad = [
        sample
        for sample in SAMPLES
        if core.search(sample) and not monaco_accepts(sample, monaco, pattern)
    ]
    unified = [sample for sample in SAMPLES if not core.search(sample)]
    print(f"monaco_misses={len(bad)}")
    for sample in bad:
        print(f"  miss {sample}")
    print(f"unified_pattern_misses={len(unified)}")
    print(f"pattern_equal={pattern_equal}")

    wkt_rs = classify_names(
        (ROOT / "crates/handshaker-core/src/grpc/invoke/well_known.rs").read_text()
    )
    wkt_ts = gen_wkt_names((ROOT / "src/lib/wellKnown.gen.ts").read_text())
    bi_rs = builtin_names(
        (ROOT / "crates/handshaker-core/src/vars/builtins.rs").read_text(),
        r"pub const BUILTIN_NAMES: &\[[^]]*\] = &\[",
    )
    bi_ts = builtin_names(
        (ROOT / "src/features/vars/builtins.gen.ts").read_text(),
        r"export const BUILTIN_NAMES = \[",
    )
    print(f"wkt_equal={wkt_rs == wkt_ts} n={len(wkt_rs)}")
    print(f"builtin_equal={bi_rs == bi_ts} n={len(bi_rs)}")
    synthetic_ok = (wkt_rs - {"google.protobuf.FieldMask"}) != wkt_ts
    print(f"synthetic_wkt_drift_detected={synthetic_ok}")
    if not synthetic_ok:
        print("self-test failed: dropping FieldMask did not diverge the sets")
        return 2
    drifted = bool(bad) or not pattern_equal or wkt_rs != wkt_ts or bi_rs != bi_ts
    return 1 if drifted else 0


if __name__ == "__main__":
    sys.exit(main())
