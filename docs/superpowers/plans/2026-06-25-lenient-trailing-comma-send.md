# Lenient trailing-comma on Send — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 📝 NOT STARTED · branch `claude/hopeful-mccarthy-4e1a0c` · spec
`docs/superpowers/specs/2026-06-25-lenient-trailing-comma-send-design.md`

**Goal:** A request body with a genuine trailing comma (`,` directly before `}`/`]`) no longer fails Send — the comma is silently stripped on the wire before deserialization, with everything else (including malformed JSON) untouched.

**Architecture:** A pure, string-aware text scrub `strip_trailing_commas(&str) -> Cow<str>` in `handshaker-core`, applied to `request_json` inside `invoke_unary` right before the existing `serde_json::Deserializer`. No `JSON.parse`/re-serialize, so int64 precision and formatting survive. Backend-only — no frontend / IPC / bindings change.

**Tech Stack:** Rust, `std::borrow::Cow`, `serde_json` (the same strict parser `prost_reflect::DynamicMessage::deserialize` runs on top of).

---

## File Structure

- **Create:** `crates/handshaker-core/src/grpc/invoke/lenient.rs` — the `strip_trailing_commas` scrub + its private `next_significant_is_close` helper + unit + integration tests. One responsibility: forgive trailing commas in a JSON text without touching string contents.
- **Modify:** `crates/handshaker-core/src/grpc/invoke/mod.rs` — declare `mod lenient;` and route `request_json` through `strip_trailing_commas` in `invoke_unary`.

No other files. Frontend already tolerates trailing commas for *display* (`src/features/bodyview/parse.ts` `repairTrailingCommas`); per the chosen silent-on-wire behavior the editor text is deliberately left alone, so nothing changes there.

---

### Task 1: `strip_trailing_commas` pure scrub

**Files:**
- Create: `crates/handshaker-core/src/grpc/invoke/lenient.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (add `mod lenient;`)

- [ ] **Step 1: Declare the module so the test file compiles**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, add the module declaration next to the existing `mod well_known;` (line ~15):

```rust
pub(crate) mod skeleton;
pub mod schema;
mod well_known;
mod lenient;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/handshaker-core/src/grpc/invoke/lenient.rs` with ONLY the tests for now (no `strip_trailing_commas` yet, so it fails to compile = a failing test):

```rust
//! Lenient JSON pre-processing for the request body sent on Send.
//!
//! The only leniency is forgiving a *trailing comma* — a `,` whose next
//! significant character is `}` or `]`. Everything else that is invalid JSON
//! (double commas, sparse arrays, comments, trailing junk) is left intact so the
//! strict `serde_json` deserializer behind `prost_reflect::DynamicMessage` still
//! rejects it. This is a pure text scrub: no number is ever parsed or
//! re-serialized, so int64 precision and the user's formatting are preserved.

#[cfg(test)]
mod tests {
    use super::strip_trailing_commas;
    use std::borrow::Cow;

    #[test]
    fn strips_object_trailing_comma() {
        assert_eq!(strip_trailing_commas("{\"a\":1,}"), "{\"a\":1}");
    }

    #[test]
    fn strips_array_trailing_comma() {
        assert_eq!(strip_trailing_commas("[1,2,]"), "[1,2]");
    }

    #[test]
    fn strips_trailing_comma_with_whitespace_before_brace() {
        assert_eq!(strip_trailing_commas("{\"a\":1,\n}"), "{\"a\":1\n}");
    }

    #[test]
    fn strips_nested_trailing_commas() {
        assert_eq!(
            strip_trailing_commas("{\"a\":[1,2,],}"),
            "{\"a\":[1,2]}"
        );
    }

    #[test]
    fn keeps_interior_comma() {
        // The comma between fields is not trailing — it must stay.
        assert_eq!(strip_trailing_commas("{\"a\":1,\"b\":2}"), "{\"a\":1,\"b\":2}");
    }

    #[test]
    fn does_not_touch_comma_inside_string_value() {
        // The reason a string-aware scan is required: a bare regex would corrupt
        // this string value into `"x  ]"`.
        let input = "{\"a\":\"x, ]\"}";
        assert_eq!(strip_trailing_commas(input), input);
    }

    #[test]
    fn escaped_quote_does_not_end_string() {
        // The `\"` keeps us inside the string, so the comma is interior to it.
        let input = "{\"a\":\"\\\", ]\"}";
        assert_eq!(strip_trailing_commas(input), input);
    }

    #[test]
    fn double_trailing_comma_only_strips_one() {
        // Only a genuine single trailing comma is forgiven; `,,]` stays `,]`
        // (and the strict parser will still reject it). Documented boundary.
        assert_eq!(strip_trailing_commas("[1,2,,]"), "[1,2,]");
    }

    #[test]
    fn clean_input_is_borrowed_no_alloc() {
        assert!(matches!(
            strip_trailing_commas("{\"a\":1}"),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn preserves_large_int64_verbatim() {
        // Pure text scrub — the big integer is copied byte-for-byte, never parsed.
        assert_eq!(
            strip_trailing_commas("{\"id\":12345678901234567890,}"),
            "{\"id\":12345678901234567890}"
        );
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p handshaker-core lenient`
Expected: FAIL — compile error `cannot find function strip_trailing_commas in this scope` (the function does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Prepend the implementation to `crates/handshaker-core/src/grpc/invoke/lenient.rs`, above the `#[cfg(test)] mod tests` block (keep the module doc-comment at the very top):

```rust
use std::borrow::Cow;

/// Remove JSON trailing commas (a `,` whose next significant character is `}` or
/// `]`) from `input`. Returns `Cow::Borrowed` when there is nothing to strip, so
/// the common clean-body path allocates nothing.
///
/// String-aware: commas inside string literals are copied verbatim, so a value
/// like `"x, ]"` is never corrupted. Only a genuine trailing comma is dropped —
/// any other malformed JSON is left intact for the strict deserializer to reject.
pub(crate) fn strip_trailing_commas(input: &str) -> Cow<'_, str> {
    let bytes = input.as_bytes();
    let mut in_string = false;
    let mut escaped = false;
    // Allocated lazily on the first dropped comma, back-filled with the clean
    // prefix seen so far; stays `None` (⇒ Borrowed) when nothing is dropped.
    let mut out: Option<Vec<u8>> = None;

    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if let Some(o) = out.as_mut() {
                o.push(b);
            }
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        if b == b'"' {
            in_string = true;
            if let Some(o) = out.as_mut() {
                o.push(b);
            }
            continue;
        }
        if b == b',' && next_significant_is_close(bytes, i + 1) {
            // First drop: materialize the buffer with the clean prefix (which
            // already excludes this comma at index `i`). The comma is not pushed.
            out.get_or_insert_with(|| bytes[..i].to_vec());
            continue;
        }
        if let Some(o) = out.as_mut() {
            o.push(b);
        }
    }

    match out {
        None => Cow::Borrowed(input),
        // Only ASCII `,` bytes are ever dropped and every other byte is copied
        // verbatim, so the result is still valid UTF-8.
        Some(o) => Cow::Owned(
            String::from_utf8(o).expect("only ASCII commas dropped; result is valid UTF-8"),
        ),
    }
}

/// True if, skipping JSON whitespace from `start`, the next byte is `}` or `]`.
fn next_significant_is_close(bytes: &[u8], start: usize) -> bool {
    let mut j = start;
    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
        j += 1;
    }
    matches!(bytes.get(j), Some(b'}') | Some(b']'))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p handshaker-core lenient`
Expected: PASS — all 10 tests green, no warnings from this file.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/lenient.rs crates/handshaker-core/src/grpc/invoke/mod.rs
git commit -m "feat(invoke): string-aware strip_trailing_commas scrub"
```

---

### Task 2: Wire the scrub into `invoke_unary`

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (the `invoke_unary` body, around line 116)
- Test: `crates/handshaker-core/src/grpc/invoke/lenient.rs` (add a parser-acceptance regression test)

- [ ] **Step 1: Write the failing regression test**

This test proves the scrub makes a previously-rejected body parse with the *same* strict `serde_json` parser that `prost_reflect::DynamicMessage::deserialize` runs on top of. Add it inside the existing `#[cfg(test)] mod tests` block in `crates/handshaker-core/src/grpc/invoke/lenient.rs`:

```rust
    #[test]
    fn scrubbed_body_parses_with_strict_serde_json() {
        // Baseline: strict serde_json rejects the trailing comma (this is exactly
        // the `trailing comma at line N` error the user hit on Send).
        assert!(serde_json::from_str::<serde_json::Value>("{\"a\":1,}").is_err());

        // After the scrub the same strict parser accepts it.
        let cleaned = strip_trailing_commas("{\"a\":1,}");
        let v: serde_json::Value =
            serde_json::from_str(&cleaned).expect("scrubbed body must parse");
        assert_eq!(v["a"], serde_json::json!(1));
    }
```

- [ ] **Step 2: Run it to verify it passes already (scrub correctness), confirming the baseline**

Run: `cargo test -p handshaker-core lenient::tests::scrubbed_body_parses_with_strict_serde_json`
Expected: PASS — the scrub already produces parseable output. (This test guards the contract; it is green because Task 1's function is correct. The *wiring* below is what carries it into Send.)

- [ ] **Step 3: Wire the scrub into `invoke_unary`**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, find these lines inside `invoke_unary` (around line 116):

```rust
    let mut deserializer = serde_json::Deserializer::from_str(request_json);
    let request_msg =
        prost_reflect::DynamicMessage::deserialize(input_desc.clone(), &mut deserializer)
            .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
```

Replace them with (route `request_json` through the scrub first):

```rust
    let cleaned = lenient::strip_trailing_commas(request_json);
    let mut deserializer = serde_json::Deserializer::from_str(&cleaned);
    let request_msg =
        prost_reflect::DynamicMessage::deserialize(input_desc.clone(), &mut deserializer)
            .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
```

The following `deserializer.end()` call (catches trailing junk) is unchanged.

- [ ] **Step 4: Run the full core suite to verify nothing regressed**

Run: `cargo test -p handshaker-core`
Expected: PASS — all existing core tests plus the new `lenient` tests are green.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/mod.rs crates/handshaker-core/src/grpc/invoke/lenient.rs
git commit -m "feat(invoke): forgive trailing commas in the request body on Send"
```

---

### Task 3: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the workspace test gate**

Run: `cargo test --workspace`
Expected: PASS — core + `src-tauri` both green, no new warnings.

- [ ] **Step 2: Confirm no frontend/bindings impact**

No IPC signature changed (`invoke_unary` keeps the same `request_json: &str`), so `src/ipc/bindings.ts` does not drift and no frontend test runs are required. Confirm by inspection: `git diff --name-only main...HEAD` lists only the two backend files + the spec/plan docs.

- [ ] **Step 3: Update the spec status banner**

Edit `docs/superpowers/specs/2026-06-25-lenient-trailing-comma-send-design.md`: change the status line to `🎉 DONE 2026-06-25` and commit:

```bash
git add docs/superpowers/specs/2026-06-25-lenient-trailing-comma-send-design.md
git commit -m "docs(spec): mark lenient trailing-comma DONE"
```

---

## Manual verification (after the gate)

In a live `pnpm tauri:dev` WebView2 window, against a reachable gRPC endpoint:

1. Put a body with a trailing comma, e.g. `{\n  "name": "x",\n}` → **Send** → succeeds (no `trailing comma at line` error).
2. Array trailing comma in a repeated field → Send succeeds.
3. A string value literally containing `, ]` (e.g. `{"note": "a, ]"}` on a string field) → Send sends the string verbatim (comma preserved in the value), confirming no corruption.
4. A genuinely broken body (`{"a":1,,}`) → Send still shows a JSON error (we only forgive a single trailing comma).

---

## Self-review notes

- **Spec coverage:** silent wire-strip (Task 2 wiring) · trailing-comma-only / others still error (`double_trailing_comma_only_strips_one`, manual #4) · string-aware no-corruption (`does_not_touch_comma_inside_string_value`, `escaped_quote_does_not_end_string`, manual #3) · int64 precision (`preserves_large_int64_verbatim`) · no-alloc clean path (`clean_input_is_borrowed_no_alloc`) · backend-only / no bindings drift (Task 3 Step 2). All spec sections map to a task.
- **No placeholders:** every step has concrete code/commands and expected output.
- **Type consistency:** `strip_trailing_commas(&str) -> Cow<str>` and `next_significant_is_close(&[u8], usize) -> bool` are used with identical signatures in Task 1 and Task 2; module path `lenient::strip_trailing_commas` matches the `mod lenient;` declaration.
