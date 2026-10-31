#!/usr/bin/env python3
"""Check the stream open / cancel / release model, then the real handoff tests.

Exit 0 means this run matches the recorded result. That result includes one
finding, printed first. Exit 1 means the model, the trace, or the Rust tests
moved. Read SKILL.md before treating either code as a product bug.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def repo_root() -> Path:
    for candidate in [HERE, *HERE.parents]:
        if (candidate / "src-tauri" / "Cargo.toml").is_file():
            return candidate
    raise SystemExit(f"no Handshaker checkout above {HERE}")


REPO = repo_root()
JAR_URL = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
SPEC = "StreamLifecycle.tla"
ACTION = re.compile(r"^State \d+: <(\w+)", re.M)
VIOLATED = re.compile(r"Invariant (\w+) is violated")
DISTINCT = re.compile(r"(\d+) distinct states found, 0 states left on queue")

HOLDS_TEST = "grpc_cancel_during_the_open_hand_off_still_cancels_the_stream_call"
DEAD_TEST = "stream_open_frees_the_call_when_the_channel_is_dead_at_opened"


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def sync_value(key: str) -> str:
    for line in (HERE / "SYNC.txt").read_text().splitlines():
        name, _, value = line.partition(" ")
        if name == key:
            return value.strip()
    fail(f"SYNC.txt has no {key} line")
    return ""


def jar_path() -> Path:
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    dest = cache / "handshaker" / "tla2tools-1.7.4.jar"
    expect = sync_value("tlc_sha256")
    if dest.is_file() and hashlib.sha256(dest.read_bytes()).hexdigest() == expect:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {JAR_URL}")
    urllib.request.urlretrieve(JAR_URL, dest)
    got = hashlib.sha256(dest.read_bytes()).hexdigest()
    if got != expect:
        dest.unlink(missing_ok=True)
        fail(f"tla2tools.jar sha256 {got} != {expect}")
    return dest


def actions(text: str) -> list[str]:
    names = [m.group(1) for m in ACTION.finditer(text) if m.group(1) != "Initial"]
    return names


def run_tlc(jar: Path, config: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="stream-lifecycle-tlc-") as tmp:
        proc = subprocess.run(
            [
                "java",
                "-XX:+UseParallelGC",
                "-cp",
                str(jar),
                "tlc2.TLC",
                "-workers",
                "1",
                "-cleanup",
                "-metadir",
                tmp,
                "-config",
                str(HERE / config),
                SPEC,
            ],
            cwd=HERE,
            text=True,
            capture_output=True,
        )
    text = proc.stdout + proc.stderr
    out = HERE / "StreamLifecycle.out"
    if out.exists():
        out.unlink()
    return proc.returncode, text


def expect_holds(text: str, code: int) -> None:
    if code != 0:
        fail("NoLostCancel failed on the model of the current code\n" + text)
    match = DISTINCT.search(text)
    if not match:
        fail("TLC did not finish the holds check\n" + text)
    want = sync_value("holds_states")
    if match.group(1) != want:
        fail(
            f"holds check visited {match.group(1)} states, SYNC.txt records {want}. "
            "Read the spec against the code before changing holds_states."
        )


def expect_trace(text: str, code: int, invariant: str, trace_name: str) -> list[str]:
    if code == 0:
        fail(f"{invariant} held. The recorded result says it is violated.\n" + text)
    found = VIOLATED.search(text)
    if not found or found.group(1) != invariant:
        got = found.group(1) if found else "no invariant"
        fail(f"{trace_name} violated {got}, expected {invariant}\n" + text)
    got = actions(text)
    want = [
        line
        for line in (HERE / trace_name).read_text().splitlines()
        if line.strip()
    ]
    if got != want:
        fail(
            f"{trace_name} trace changed.\n"
            f"recorded: {' '.join(want)}\n"
            f"this run: {' '.join(got)}\n"
            "A different trace is a new finding or a model edit. "
            "Do not overwrite the trace file until the skill's replay matches it."
        )
    return got


def run_one_rust(name: str) -> None:
    proc = subprocess.run(
        ["cargo", "test", "-p", "handshaker", "--lib", name, "--", "--test-threads=1"],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    out = proc.stdout + proc.stderr
    if proc.returncode != 0 or "1 passed" not in out:
        sys.stderr.write(out)
        fail(
            f"Rust test {name} did not pass. "
            "The spec still describes the previous code, so TLC will not be the line that goes red. "
            f"A failure of {HOLDS_TEST} means a raced Cancel no longer reaches the stream call."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-only",
        action="store_true",
        help="skip the Rust tests that compile the Tauri crate",
    )
    args = parser.parse_args()
    if shutil.which("java") is None:
        fail("java is not on PATH. Install a JDK (11 or newer) and rerun.")

    jar = jar_path()
    code, text = run_tlc(jar, "holds.cfg")
    expect_holds(text, code)
    code, text = run_tlc(jar, "orphan.cfg")
    orphan = expect_trace(text, code, "NoOrphanAfterRelease", "orphan.trace")
    code, text = run_tlc(jar, "broken-cancel.cfg")
    broken = expect_trace(text, code, "NoLostCancel", "broken-cancel.trace")

    print("RECORDED FINDING, not a new disagreement with the code.", flush=True)
    print(
        "Leaving a stream while Open is still waiting leaves the call running "
        "in the stream registry.",
        flush=True,
    )
    print("steps: " + " -> ".join(orphan), flush=True)
    print(
        f"NoLostCancel holds ({sync_value('holds_states')} states). "
        "The broken cancel variant still fails, steps: " + " -> ".join(broken),
        flush=True,
    )
    print(f"sync {sync_value('sync')}", flush=True)
    if args.model_only:
        print("rust: skipped (--model-only)")
        return
    dist = REPO / "dist" / "index.html"
    if not dist.is_file():
        fail(
            "dist/index.html is missing. From the repo root run "
            "`pnpm install` and `pnpm build`, then rerun this command."
        )
    if shutil.which("cargo") is None:
        fail("cargo is not on PATH")
    for name in (HOLDS_TEST, DEAD_TEST):
        run_one_rust(name)
    print(f"rust: {HOLDS_TEST} passed")
    print(f"rust: {DEAD_TEST} passed")


if __name__ == "__main__":
    main()
