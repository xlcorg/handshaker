#!/usr/bin/env python3
"""Quantify agent pitfall classes in the Handshaker git history and worktree.

Rerun from the repo root:

    python3 scripts/quantify-agent-pitfalls.py

Read-only. Prints a markdown report. Exit 0 when every evidence SHA still
resolves to the subject prefix stored below. Exit 1 when a cited SHA is
missing or its subject changed (the report would be citing the wrong commit).

Classification rules are in `classes()`. They are keyword-and-path predicates
over `fix` commits, plus a few non-fix subject rules (string centralization,
bindings regeneration). A commit is counted in the first class whose predicate
matches, so the class counts are disjoint. The report also prints the
overlapping hits a reviewer can audit.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Subject prefixes the evidence SHAs must still have. Guard against citing a
# rewritten history. Short SHAs are matched by prefix.
EVIDENCE = {
    "0ba7bfa": "fix(ui): disable bracket-pair colorization",
    "a667f2a": "fix(ui): disable rainbow bracket-pair coloring",
    "574405b": "fix(bodyview): disable occurrencesHighlight",
    "5910745": "fix(bodyview): forward view-zone right-click",
    "990e994": "fix(bodyview): open context menu on right-click",
    "b09b3f9": "fix(bodyview): collapse reserved scrollbar slot",
    "d46c810": "fix(bodyview): minimap replaces the vertical scrollbar",
    "1a0401e": "fix(bodyview): strip Monaco's default",
    "7e81b49": "fix(bodyview): set base64 gate on right-button",
    "4465d1f": "fix(response): drop response-side inlay",
    "2b0a2ba": "fix(bodyview): guard inlay-provider",
    "de1d424": "fix(bodyview): align ghost skeleton",
    "8f157e6": "fix(bodyview): pin ghost skeleton",
    "404632e": "fix(bodyview): anchor ghost skeleton",
    "f76e445": "fix(bodyview): suppress ghost",
    "ad58092": "fix(bodyview): re-anchor ghost",
    "52f8092": "fix(bodyview): tolerate trailing commas",
    "3cf0f09": "fix(bodyview): recompute ghost",
    "715bdeb": "fix(bodyview): ghost cleanup",
    "78d709a": "fix(env-editor): make selected color obvious",
    "2c6fbd6": "fix(env-editor): selected color shown by ring only",
    "6830eb8": "fix(shell): keep method name visible",
    "4308b57": "fix(shell): show only method names",
    "87230b1": "fix(palette): Tab completes the selected row",
    "0fbe103": "fix(contract): auto-refresh reflection",
    "4e23444": "fix(auth): refresh env list",
    "b697b5f": "fix(workflow): make onSend idempotent",
    "fa8f009": "fix(reflection): refresh re-fetches",
    "754d2a3": "fix(catalog): re-resolve collection var preview",
    "82ef6d1": "fix(catalog): cancel stale describe",
    "8e121c0": "fix(app): route send result",
    "4b09613": "fix(auth-editor): keep cleared Header name",
    "1d24b3c": "fix(collections): local buffer",
    "4ea8f22": "fix(envs): show existing variables",
    "53bcda5": "fix(envs): VariablesTable empty-row",
    "8b0a611": "fix(vars): keep input focus",
    "015d6ef": "fix(ui): forward refs through dialog",
    "8aac627": "fix(ui): Button forwardRef",
    "dac2898": "fix(tls): per-request TLS tri-state",
    "c676d90": "fix(bodyview): validate recognizes both proto and JSON",
    "cfd85e9": "fix(contract): show well-known types",
    "5da3db6": "fix(invoke): map scalar well-known types",
    "ff11894": "fix(vars): align {{var}} grammar",
    "b2c1707": "fix(workflow): inherit collection auth",
    "266482a": "fix(ui): compile-time builtin desc completeness",
    "ea246a8": "fix(shell): disable macOS autocorrect",
    "ce9c748": "fix(base64): let macOS Save-As",
    "5e74fc7": "fix(wordwrap): macOS hotkey",
    "ea7e564": "fix(envs): stop Cmd+E",
    "8306932": "fix(zoom): ignore AltGr",
    "d873436": "fix(titlebar): correct macOS traffic-light",
    "216384e": "fix(titlebar): lower macOS traffic-light",
    "285158d": "fix(titlebar): hide native macOS window title",
    "2f4bcac": "fix(invoke): Ctrl+Enter listener moves to capture phase",
    "dbd11cc": "fix(bodyview): cast wordWrap ternary",
    "fcca551": "fix(test): use vi.mocked",
    "178e3a2": "fix(bodyview): narrow regex match",
    "53755a2": "fix(catalog): narrow union before header_name",
    "3932c5c": "fix(auth): clamp OAuth2 expires_in",
    "d5b88f0": "fix(core): accept fractional expires_in",
    "ee348b4": "fix(test): shim Storage",
    "40ea7b1": "fix(verify): correct control-app notes",
    "c99d5ba": "fix(catalog): keep Tooltip pristine",
    "d9c2301": "fix(verify): save screenshots",
    "cf1dd22": "fix(tauri): grant core:window:allow-start-dragging",
    "092093f": "fix(tauri): grant window close",
    "110ee31": "fix(envs): preserve variable order",
    "a0b9379": "docs(rules): commit messages",
    "d2d7aa3": "fix(envs): place save status",
    "d925c7f": "refactor(palette): centralize command-palette strings",
    "fc58010": "refactor(shell): centralize Titlebar strings",
    "2be33fa": "RALPH: refactor(collections): auth editor strings",
    "4cc5c0c": "refactor(settings): centralize the Shortcuts",
    "da66388": "feat(bodyview): wire onSaveBody",
    "0079495": "feat(settings): list Split direction shortcut",
    "61fb974": "chore(ipc): regenerate bindings for grpc_message_schema",
    "625241b": "chore(ipc): regenerate TS bindings",
    "c8b9858": "chore(ipc): regenerate bindings for target-based",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, errors="replace")


def parse_commits() -> list[dict]:
    raw = git("log", "--numstat", "--format=---COMMIT---%n%H%n%ad%n%s%n---BODY---%n%b%n---END---", "--date=short")
    commits = []
    for chunk in raw.split("---COMMIT---\n"):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        head, _, tail = chunk.partition("\n---BODY---\n")
        body, _, rest = tail.partition("\n---END---\n")
        lines = head.splitlines()
        sha, date, subj = lines[0], lines[1], lines[2] if len(lines) > 2 else ""
        files = []
        churn = 0
        for line in rest.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            files.append(parts[2])
            if parts[0].isdigit() and parts[1].isdigit():
                churn += int(parts[0]) + int(parts[1])
        commits.append(
            {
                "sha": sha,
                "short": sha[:7],
                "date": date,
                "subj": subj,
                "body": body.strip(),
                "files": files,
                "churn": churn,
            }
        )
    return commits


def blob(c: dict) -> str:
    return (c["subj"] + "\n" + c["body"]).lower()


def is_fix(c: dict) -> bool:
    return bool(re.match(r"^(RALPH: )?fix\b", c["subj"]))


def under(c: dict, prefixes: tuple[str, ...]) -> bool:
    return any(f.startswith(prefixes) for f in c["files"])


def classes() -> list[tuple[str, str, object]]:
    """(id, one-line rule, predicate). First match wins."""

    def monaco_api(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        # Platform chords and ghost-pixel commits mention Monaco in the body.
        # They belong to those classes, not to the editor-API class.
        if "macos" in subj or "hotkey" in subj or "ghost skeleton" in subj or "re-anchor ghost" in subj or "suppress ghost" in subj:
            return False
        if not under(c, ("src/features/bodyview/", "src/lib/monaco.ts", "src/features/response/")):
            return False
        return bool(
            re.search(
                r"bracket|coloriz|context menu|view-zone|view zone|minimap|occurrences|inlay|command palette",
                blob(c),
            )
        )

    def visual_followup(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        if subj.startswith("fix(bodyview):") and "ghost" in blob(c):
            return True
        if "selected color" in subj:
            return True
        if subj.startswith("fix(shell):") and "method name" in subj:
            return True
        return False

    def stale_identity(c: dict) -> bool:
        if not is_fix(c):
            return False
        return bool(
            re.search(
                r"env change|env-revision|re-resolve collection var|re-fetches contract|idempotent|originating tab|selected row, not the first|stale describe",
                blob(c),
            )
        )

    def edit_buffer(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        return bool(
            re.search(r"local buffer|show existing variables when reopening", subj)
        )

    def remount(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        return (
            "empty-row promoted" in subj
            or "keep input focus when clearing" in subj
            or "forward refs through dialog" in subj
            or "button forwardref" in subj
        )

    def core_mirror(c: dict) -> bool:
        if not is_fix(c):
            return False
        return bool(
            re.search(
                r"grammar with core|inherit collection auth|tri-state|well-known types|proto and json field names|builtin desc completeness",
                blob(c),
            )
        )

    def platform(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        if re.search(r"macos|autocorrect|altgr|cmd\+e|save-as|traffic-light", subj):
            return True
        return "capture phase" in subj

    def tsc_gate(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        return bool(re.search(r"\btsc\b|typechecks|narrow union before header_name", subj))

    def expires(c: dict) -> bool:
        return is_fix(c) and "expires_in" in blob(c)

    def harness(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        return bool(
            re.search(r"jsdom|control-app notes|tooltip pristine|save screenshots into the run", subj)
        )

    def capability(c: dict) -> bool:
        if not is_fix(c):
            return False
        subj = c["subj"].lower()
        return subj.startswith("fix(tauri): grant")

    return [
        ("monaco_api_layer", "fix touches bodyview/monaco and talks about Monaco's own API (brackets, menu, minimap, inlay)", monaco_api),
        ("visual_followup", "fix(bodyview) ghost positioning, or a second pass on color/method-picker copy", visual_followup),
        ("stale_identity", "fix whose body is an effect or handler keyed on a partial identity", stale_identity),
        ("edit_buffer", "fix that adds or repairs a local edit buffer against a store echo", edit_buffer),
        ("remount_drops_state", "fix for focus or edits lost because a component identity changed", remount),
        ("core_rule_copied", "fix that re-syncs a frontend copy of a core rule (grammar, auth, tls, wkt, builtins)", core_mirror),
        ("platform_shell", "fix whose subject is a macOS, WebKit, or capture-phase chord", platform),
        ("committed_before_tsc", "fix whose subject says it exists to satisfy tsc", tsc_gate),
        ("expires_in_parser", "fix of OAuth2 expires_in parsing", expires),
        ("harness_mismatch", "fix of a test or drive harness that disagreed with the runtime", harness),
        ("capability_followup", "fix(tauri) that grants a permission after the action already shipped", capability),
    ]


def trailer_stats(commits: list[dict], ban_sha_prefix: str) -> dict:
    seen_ban = False
    # git log is newest first
    after = before = 0
    after_n = before_n = 0
    examples = []
    # Walk oldest first so "after the ban" is well defined.
    for c in reversed(commits):
        has = "co-authored-by:" in c["body"].lower()
        if c["sha"].startswith(ban_sha_prefix):
            seen_ban = True
            continue
        if not seen_ban:
            before_n += 1
            before += int(has)
        else:
            after_n += 1
            after += int(has)
            if has and len(examples) < 8:
                examples.append(f"{c['short']} {c['subj']}")
    # examples were collected oldest-first; the plan wants recent ones
    recent = []
    for c in commits:
        if "co-authored-by:" in c["body"].lower():
            recent.append(f"{c['short']} {c['subj']}")
            if len(recent) >= 8:
                break
    return {
        "total": before + after,
        "before": before,
        "before_n": before_n,
        "after": after,
        "after_n": after_n,
        "recent": recent,
    }


def nonfix_subjects(commits: list[dict], rx: re.Pattern[str]) -> list[dict]:
    return [c for c in commits if rx.search(c["subj"])]


def followup_stats(fixes: list[dict]) -> tuple[int, int]:
    """A fix is a follow-up when it touches a file an earlier fix already touched."""
    seen: set[str] = set()
    follow = 0
    # oldest first
    for c in reversed(fixes):
        if any(f in seen for f in c["files"]):
            follow += 1
        seen.update(c["files"])
    return follow, len(fixes)


def code_churn(commits: list[dict]) -> list[tuple[int, int, int, str]]:
    touches: Counter[str] = Counter()
    churn: Counter[str] = Counter()
    fix_touches: Counter[str] = Counter()
    skip_prefix = ("docs/", "Cargo.lock", "pnpm-lock.yaml")
    for c in commits:
        for f in c["files"]:
            if f.startswith(skip_prefix) or f.endswith(".lock"):
                continue
            touches[f] += 1
        # churn is per commit, attribute the whole commit churn only to files we don't have line stats for
    # recompute line churn from numstat already stored as commit churn split? We only stored commit total.
    # Second pass: we need per-file add+del. Re-read via the files only for touch counts, and a dedicated numstat.
    raw = git("log", "--numstat", "--format=COMMIT %s")
    cur_fix = False
    for line in raw.splitlines():
        if line.startswith("COMMIT "):
            subj = line[7:]
            cur_fix = subj.startswith("fix") or subj.startswith("RALPH: fix")
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        path = parts[2]
        if path.startswith(skip_prefix) or path.endswith(".lock"):
            continue
        if parts[0].isdigit() and parts[1].isdigit():
            churn[path] += int(parts[0]) + int(parts[1])
        if cur_fix:
            fix_touches[path] += 1
    rows = []
    for path, n in touches.most_common(15):
        rows.append((n, churn[path], fix_touches[path], path))
    return rows


def live_mirrors() -> dict:
    var_rs = (ROOT / "crates/handshaker-core/src/vars/mod.rs").read_text()
    monaco = (ROOT / "src/lib/monaco.ts").read_text()
    highlight = (ROOT / "src/features/vars/VarHighlightInput.tsx").read_text()
    has_vars = (ROOT / "src/features/vars/useVarResolve.ts").read_text()
    # The source contains r"\{\{([^{}]+)\}\}"
    rust_literal = re.search(r'static VAR_RE:.*?Regex::new\(r"(.*?)"\)', var_rs, re.S)
    highlight_re = re.search(r"matchAll\((/.+?/)g\)", highlight)
    has_re = re.search(r"return (/.*?/)\.test", has_vars)
    monaco_user = re.findall(r"/\\\{\\\{\[a-zA-Z_\]\[a-zA-Z0-9_\\-\]\*\\\}\\\}/", monaco)
    monaco_dyn = re.findall(r"/\\\{\\\{\\\$\[a-zA-Z\]\[a-zA-Z0-9_\\-\]\*\\\}\\\}/", monaco)

    def match_arm_names(path: Path) -> set[str]:
        """Names in `classify`'s match arms only, not the comment that lists exclusions."""
        found = set()
        for line in path.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith('"google.protobuf.') and "=>" in stripped:
                found.update(re.findall(r'"(google\.protobuf\.[A-Za-z0-9]+)"', stripped))
        return found

    def record_names(path: Path) -> set[str]:
        found = set()
        for line in path.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith('"google.protobuf.'):
                found.update(re.findall(r'"(google\.protobuf\.[A-Za-z0-9]+)"', stripped))
        return found

    def builtin_match(path: Path) -> set[str]:
        text = path.read_text()
        block = re.search(r"fn is_builtin.*?matches!\((.*?)\)", text, re.S)
        if not block:
            return set()
        return set(re.findall(r'"(\$[A-Za-z0-9]+)"', block.group(1)))

    def builtin_array(path: Path) -> set[str]:
        text = path.read_text()
        block = re.search(r"BUILTIN_NAMES = \[(.*?)\]", text, re.S)
        if not block:
            return set()
        return set(re.findall(r'"(\$[A-Za-z0-9]+)"', block.group(1)))

    rust_wkt = match_arm_names(ROOT / "crates/handshaker-core/src/grpc/invoke/well_known.rs")
    ts_wkt = record_names(ROOT / "src/lib/wellKnown.ts")
    rust_bi = builtin_match(ROOT / "crates/handshaker-core/src/vars/builtins.rs")
    ts_bi = builtin_array(ROOT / "src/features/vars/builtins.ts")

    resolve_sites = []
    for path in ROOT.joinpath("src").rglob("*.tsx"):
        text = path.read_text()
        for i, line in enumerate(text.splitlines(), 1):
            if "envRevision" in line and ("`" in line or "resolveKey" in line or "addressResolveKey" in line):
                if "envRevision}" in line:
                    resolve_sites.append(f"{path.relative_to(ROOT)}:{i}:{line.strip()}")

    keydowns = []
    for path in ROOT.joinpath("src").rglob("*.ts*"):
        if ".test." in path.name:
            continue
        text = path.read_text()
        if 'addEventListener("keydown"' in text or "addEventListener('keydown'" in text:
            keydowns.append(str(path.relative_to(ROOT)))

    return {
        "rust_var_re": rust_literal.group(1) if rust_literal else "MISSING",
        "highlight_re": highlight_re.group(1) if highlight_re else "MISSING",
        "has_vars_re": has_re.group(1) if has_re else "MISSING",
        "monaco_user_rules": len(monaco_user),
        "monaco_dynamic_rules": len(monaco_dyn),
        "wkt_only_rust": sorted(rust_wkt - ts_wkt),
        "wkt_only_ts": sorted(ts_wkt - rust_wkt),
        "wkt_shared": len(rust_wkt & ts_wkt),
        "builtin_only_rust": sorted(rust_bi - ts_bi),
        "builtin_only_ts": sorted(ts_bi - rust_bi),
        "builtin_shared": sorted(rust_bi & ts_bi),
        "resolve_sites": resolve_sites,
        "keydowns": keydowns,
    }


def string_hits() -> list[str]:
    """Conservative user-facing string candidates. Not a finished lint."""
    hits = []
    attr = re.compile(
        r'(?:placeholder|title|aria-label|aria-description|ariaLabel)="([^"\n]*)"'
    )
    toast = re.compile(
        r"""toast\.(?:success|error|message|info|warning|loading)\(\s*"([^"\n]+)"""
    )
    jsx = re.compile(r""">([A-Za-z][^<{\n]{2,80})<""")
    for path in ROOT.joinpath("src").rglob("*.ts*"):
        if ".test." in path.name or path.name == "messages.ts" or path.name == "bindings.ts":
            continue
        rel = path.relative_to(ROOT)
        for i, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                continue
            if "className" in line and "placeholder" not in line and "toast." not in line and "aria-" not in line:
                # still allow the line if it also has a toast/attr; the regexes are specific
                pass
            for rx, kind in ((toast, "toast"), (attr, "attr"), (jsx, "jsx")):
                for m in rx.finditer(line):
                    text = m.group(1).strip()
                    if kind == "jsx" and ("{" in text or text.startswith("http") or len(text.split()) < 2):
                        continue
                    if kind == "attr" and len(text) < 3:
                        continue
                    hits.append(f"{rel}:{i}:{kind}:{text[:80]}")
    return hits


def grammar_corpus(rust_re: str, highlight_re: str) -> list[tuple[str, bool, bool, bool]]:
    """Compare core/highlight (both [^{}]+) against the Monaco ident class."""
    core = re.compile(r"\{\{([^{}]+)\}\}")
    # Monaco user-var class, repeated in several monarch states.
    monaco_user = re.compile(r"\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}")
    monaco_dyn = re.compile(r"\{\{\$[a-zA-Z][a-zA-Z0-9_\-]*\}\}")
    samples = [
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
    rows = []
    for s in samples:
        rows.append((s, bool(core.search(s)), bool(monaco_user.search(s)), bool(monaco_dyn.search(s))))
    # silence unused if the extracted literals failed; still report them
    _ = (rust_re, highlight_re)
    return rows


def check_evidence(commits: list[dict]) -> list[str]:
    by_prefix = {c["sha"]: c["subj"] for c in commits}
    problems = []
    for short, prefix in EVIDENCE.items():
        match = next((subj for sha, subj in by_prefix.items() if sha.startswith(short)), None)
        if match is None:
            problems.append(f"missing {short}")
        elif not match.startswith(prefix):
            problems.append(f"{short} subject {match!r} does not start with {prefix!r}")
    return problems


def main() -> int:
    commits = parse_commits()
    problems = check_evidence(commits)
    fixes = [c for c in commits if is_fix(c)]
    print("# Agent pitfall quantification")
    print()
    print(f"HEAD `{commits[0]['sha'][:12]}` ({commits[0]['date']} {commits[0]['subj']})")
    print(f"Commits: {len(commits)}. Fix commits: {len(fixes)}.")
    if commits:
        print(f"Range: {commits[-1]['date']} .. {commits[0]['date']}.")
    print()
    print("## Classes (disjoint, first match wins)")
    print()
    assigned: dict[str, list[dict]] = {cid: [] for cid, _, _ in classes()}
    for c in fixes:
        for cid, _rule, pred in classes():
            if pred(c):
                assigned[cid].append(c)
                break
    for cid, rule, _pred in classes():
        hits = assigned[cid]
        print(f"### {cid} ({len(hits)})")
        print()
        print(f"Rule: {rule}.")
        print()
        for c in hits:
            print(f"- `{c['short']}` {c['subj']}")
        print()

    print("## Non-fix classes")
    print()
    strings = nonfix_subjects(
        commits,
        re.compile(r"centralize|strings → messages|into messages", re.I),
    )
    print(f"### string_centralization ({len(strings)})")
    print()
    print("Rule: subject says centralize / into messages / strings → messages.")
    print()
    for c in strings:
        print(f"- `{c['short']}` {c['subj']}")
    print()
    bindings = nonfix_subjects(
        commits,
        re.compile(r"^(?:chore|feat)\(ipc\): regenerate\b", re.I),
    )
    print(f"### bindings_regen_commit ({len(bindings)})")
    print()
    print("Rule: subject is a regenerate-bindings chore or feat, not a product change that happens to regen.")
    print()
    for c in bindings:
        print(f"- `{c['short']}` {c['subj']}")
    print()

    print("## Trailers")
    print()
    stats = trailer_stats(commits, "a0b9379")
    print(f"Commits whose body contains `Co-authored-by`: {stats['total']} / {len(commits)}.")
    print(
        f"Before the ban commit `a0b9379`: {stats['before']} / {stats['before_n']}."
    )
    print(
        f"After `a0b9379` (the ban commit itself excluded): {stats['after']} / {stats['after_n']}."
    )
    print()
    print("Newest commits that still carry the trailer:")
    print()
    for line in stats["recent"]:
        print(f"- {line}")
    print()

    follow, nfix = followup_stats(fixes)
    print("## Follow-ups and churn")
    print()
    print(
        f"Fix commits that touch a file an earlier fix already touched: {follow} / {nfix}."
    )
    print()
    print("Code files by commit touches (docs, lockfiles excluded). Columns: touches, line churn, fix touches, path.")
    print()
    for touches, churn, ft, path in code_churn(commits):
        print(f"- {touches:4d} touches, {churn:6d} churn, {ft:3d} fixes — `{path}`")
    print()

    print("## Live copies")
    print()
    live = live_mirrors()
    print(f"Core `VAR_RE` literal: `{live['rust_var_re']}`")
    print(f"`parseSegments` regex: `{live['highlight_re']}`")
    print(f"`hasVars` regex: `{live['has_vars_re']}`")
    print(
        f"Monaco monarch user-var rules with the ident class: {live['monaco_user_rules']}. Dynamic rules: {live['monaco_dynamic_rules']}."
    )
    print()
    print("Corpus (core `[^{{}}]+` vs Monaco ident class):")
    print()
    print("| sample | core | monaco user | monaco dynamic |")
    print("| --- | --- | --- | --- |")
    for sample, core_ok, user_ok, dyn_ok in grammar_corpus(live["rust_var_re"], live["highlight_re"]):
        print(f"| `{sample}` | {core_ok} | {user_ok} | {dyn_ok} |")
    print()
    print(
        f"Well-known names shared: {live['wkt_shared']}. Only Rust: {live['wkt_only_rust'] or '[]'}. Only TS: {live['wkt_only_ts'] or '[]'}."
    )
    print(
        f"Builtin names shared: {live['builtin_shared']}. Only Rust: {live['builtin_only_rust'] or '[]'}. Only TS: {live['builtin_only_ts'] or '[]'}."
    )
    print()
    print("Resolve-key template literals containing `envRevision}`:")
    print()
    for line in live["resolve_sites"]:
        print(f"- `{line}`")
    print()
    print("Production modules that register a `keydown` listener:")
    print()
    for line in live["keydowns"]:
        print(f"- `{line}`")
    print()

    hits = string_hits()
    print("## User-facing string candidates")
    print()
    print(f"Hits outside `messages.ts`, tests, and `bindings.ts`: {len(hits)}.")
    print("A hit is `token` when the text is a single kebab/snake identifier (often a test id stuffed into aria-label).")
    print("A hit is `prose` otherwise.")
    print()
    kinds = Counter()
    shapes = Counter()
    token_re = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
    for h in hits:
        parts = h.split(":", 3)
        kind = parts[2] if len(parts) > 2 else "?"
        text = parts[3] if len(parts) > 3 else ""
        kinds[kind] += 1
        shapes["token" if token_re.match(text) else "prose"] += 1
    for kind, n in kinds.most_common():
        print(f"- {kind}: {n}")
    for shape, n in shapes.most_common():
        print(f"- shape {shape}: {n}")
    print()
    print("First 40 hits:")
    print()
    for h in hits[:40]:
        print(f"- `{h}`")
    print()
    if problems:
        print("## Evidence check FAILED")
        print()
        for p in problems:
            print(f"- {p}")
        return 1
    print("## GitHub workflows")
    print()
    wf = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / ".github/workflows").glob("*.yml"))
    print(f"Workflow files: {len(wf)}.")
    for p in wf:
        print(f"- `{p}`")
    print()
    print("Evidence SHAs: all present with the expected subject prefix.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
