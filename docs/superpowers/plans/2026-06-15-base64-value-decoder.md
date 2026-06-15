# Base64 value decoder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ✅ CODE-COMPLETE (2026-06-16) — все 7 задач + final-review fix влиты в
ветку, subagent-driven (spec+quality ревью на каждой + финальное ревью ветки).
Гейты зелёные: `cargo test --workspace` · `pnpm test` 913 · `tsc` · `vite build` ·
bindings no-drift. **Не влито в `main`** — ветка оставлена под живой WebView2-проход.
**Ветка:** `claude/busy-sinoussi-ab48fe`
**Спека:** `docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md`

**Коммиты:** core `4dba3e2`+`4e4d6dd` · IPC `8255c12` · FE-helpers `e282ed7` ·
client `9e310c5`+`3aadbae` · DecodeDialog `a6248ff` · decodeActions `b4aeaa9` ·
wiring `612e128` · **gate-timing fix `6bfe1a3`**.

**Финальное ревью поймало 1 important баг** (его юнит-тесты структурно не видели):
гейт `hsValueIsB64` ставился в `onContextMenu`, но Monaco-контроллер строит меню
из своего, более раннего `onContextMenu` → первый ПКМ не показывал Decode/Save
(off-by-one на последующих). Фикс `6bfe1a3`: гейт считается в `onMouseDown` по
**правой** кнопке (mousedown раньше события `contextmenu`), значение клика
стэшится и переиспользуется в `run`. Это **главный пункт live-проверки**.

**Пост-имплементация — изменения по live-фидбеку (2026-06-16):**
- `d6354cd` — гейт `looksLikeBase64` доп. исключает строки из hex+дефис
  (UUID/хэши/hex-id больше не показывают Decode); `3a850f4` — убран пункт
  «Command Palette» из ПКМ-меню Monaco (`contextMenuCleanup`, F1 жив);
  `6bfe1a3` — timing-фикс гейта (onMouseDown по правой кнопке).
- **`f2450fe` — диалог УБРАН.** «Decode base64» теперь декодирует на бэкенде и
  **копирует декодированный текст в буфер** (бинарь → тост→Save); полное значение
  берётся из JSON-дерева (`node.value`), не из элидированного текста редактора.
  `DecodeDialog` удалён, `BodyView.onDecode`-проп удалён, новый чистый
  `copyDecoded.ts`. (Спека: см. амендмент в `## UX`.)

**Live-проход (punch-list, в WebView2 через `pnpm tauri dev`):**
- Decode/Copy value/Save появляются в ПКМ-меню с **ПЕРВОГО** ПКМ по base64
  (timing-фикс); на не-base64/UUID/числе пункта Decode нет; «Command Palette» в
  меню нет (F1 палитру открывает).
- **Decode base64 → декодированный текст в буфере** (вставить и проверить), тост
  «Decoded base64 copied»; на длинном/элидированном значении копируется **полный**
  декод (а не из обрезанного превью) — ключевая проверка.
- Save to file… пишет валидный файл (`.json`/бинарь); отмена Save — без ошибки.
- URL-safe base64 декодится; бинарь → тост «binary … use Save to file».

**Goal:** Decode any whole base64 string value in the gRPC response Body — view it (JSON pretty-printed / text / binary type+size), copy it, or save the decoded bytes to a file.

**Architecture:** Pure decode+classify+magic-byte-sniff lives in `handshaker-core` (`base64` crate + `infer`). Two Tauri commands wrap it: `base64_inspect` (returns kind/size/text/mime) and `base64_save` (decode → native Save-As via `tauri-plugin-dialog` → write bytes). The response `BodyView` (read-only Monaco) registers three context-menu actions (Decode / Copy value / Save decoded to file…) via a pure, fake-editor-testable `attachDecodeActions` module; `ResponseBody` owns a `DecodeDialog` that reuses `BodyView` for the text/JSON case.

**Tech Stack:** Rust (`base64` 0.22, `infer`, `tauri-plugin-dialog`), tauri-specta IPC, React 18 + Monaco + Radix dialog, vitest.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/handshaker-core/src/base64/mod.rs` | **new** — `decode_lenient`, `classify`, `suggested_extension`, `Classified` enum (pure, OS-independent) |
| `crates/handshaker-core/src/lib.rs` | add `pub mod base64;` |
| `src-tauri/src/ipc/base64.rs` | **new** — `Base64InspectIpc` / `Base64KindIpc` (specta DTO) + `from_classified` |
| `src-tauri/src/commands/base64.rs` | **new** — `base64_inspect`, `base64_save` commands + `inspect_impl` helper |
| `src-tauri/src/ipc/mod.rs`, `src-tauri/src/commands/mod.rs` | add `pub mod base64;` |
| `src-tauri/src/lib.rs` | register both commands + `.plugin(tauri_plugin_dialog::init())` |
| `src-tauri/capabilities/default.json` | add `dialog:allow-save` |
| `src/ipc/bindings.ts` | regenerated (git-tracked) |
| `src/ipc/client.ts` | add `base64Inspect`, `base64Save` typed wrappers |
| `src/lib/grpc-status.ts` | add `formatByteCount(n)` (number→`1.2KB`), DRY-refactor `formatBytes` onto it |
| `src/features/bodyview/decode.ts` | **new** — `looksLikeBase64` charset gate |
| `src/features/bodyview/valueAtOffset.ts` | **new** — `stringValueAtOffset` |
| `src/features/bodyview/decodeActions.ts` | **new** — `attachDecodeActions` (context-menu actions, fake-editor testable) |
| `src/features/bodyview/BodyView.tsx` | wire `attachDecodeActions` (response mode) + `onDecode` prop |
| `src/features/response/DecodeDialog.tsx` | **new** — the decode dialog |
| `src/features/response/ResponseBody.tsx` | own `DecodeDialog` state, pass `onDecode` to `BodyView` |

**Task order (dependencies):** 1 → 2 → 3 → 4 → 5 → 6 → 7.

> **Worktree prerequisite (one-time, before any `src-tauri` cargo build in Task 2):** `generate_context!` in `lib.rs` needs `dist/` to exist at compile time. If `dist/` is absent, run `pnpm install` then `pnpm build` once. (Task 1 builds only `handshaker-core`, which does NOT need `dist/`.)

---

## Task 1: Core base64 decode + classify module

**Files:**
- Create: `crates/handshaker-core/src/base64/mod.rs`
- Modify: `crates/handshaker-core/src/lib.rs` (add `pub mod base64;`)
- Modify: `crates/handshaker-core/Cargo.toml` (deps via cargo add)

- [ ] **Step 1: Add dependencies**

Run:
```bash
cargo add base64 -p handshaker-core
cargo add infer -p handshaker-core
```
Expected: `base64` and `infer` appear under `[dependencies]` in `crates/handshaker-core/Cargo.toml`.

- [ ] **Step 2: Write the module with failing tests**

Create `crates/handshaker-core/src/base64/mod.rs`:

```rust
//! Lenient base64 decode + content classification for the response decoder.
//! Pure / OS-independent. See docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use base64::{
    alphabet,
    engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig},
    Engine as _,
};

/// What the decoded bytes turned out to be.
#[derive(Debug, Clone, PartialEq)]
pub enum Classified {
    /// Valid UTF-8 that parses as JSON. Holds the raw decoded text (front pretty-prints).
    Json(String),
    /// Valid UTF-8, not JSON. Holds the raw decoded text.
    Text(String),
    /// Not UTF-8. Magic-byte type, if `infer` recognised it.
    Binary { mime: Option<String>, extension: Option<String> },
}

/// Strip surrounding whitespace, an optional `data:<mime>;base64,` prefix, and any
/// interior whitespace/newlines (some encoders wrap base64).
fn clean(input: &str) -> String {
    let trimmed = input.trim();
    let body = if trimmed.starts_with("data:") {
        match trimmed.find(";base64,") {
            Some(i) => &trimmed[i + ";base64,".len()..],
            None => trimmed,
        }
    } else {
        trimmed
    };
    body.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Decode accepting BOTH alphabets (standard + URL-safe) and ANY padding —
/// protobuf JSON `bytes` are canonically standard-with-padding but decoders must
/// accept all four variants (ProtoJSON spec).
pub fn decode_lenient(input: &str) -> Result<Vec<u8>, String> {
    let cleaned = clean(input);
    if cleaned.is_empty() {
        return Err("Not valid base64".to_string());
    }
    // GeneralPurposeConfig is Copy, so one cfg feeds both engines.
    let cfg = GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent);
    let std_engine = GeneralPurpose::new(&alphabet::STANDARD, cfg);
    if let Ok(bytes) = std_engine.decode(cleaned.as_bytes()) {
        return Ok(bytes);
    }
    let url_engine = GeneralPurpose::new(&alphabet::URL_SAFE, cfg);
    url_engine
        .decode(cleaned.as_bytes())
        .map_err(|_| "Not valid base64".to_string())
}

/// Classify decoded bytes: JSON > text > binary (magic bytes).
pub fn classify(bytes: &[u8]) -> Classified {
    match std::str::from_utf8(bytes) {
        Ok(s) => {
            if !s.trim().is_empty() && serde_json::from_str::<serde_json::Value>(s).is_ok() {
                Classified::Json(s.to_string())
            } else {
                Classified::Text(s.to_string())
            }
        }
        Err(_) => match infer::get(bytes) {
            Some(t) => Classified::Binary {
                mime: Some(t.mime_type().to_string()),
                extension: Some(t.extension().to_string()),
            },
            None => Classified::Binary { mime: None, extension: None },
        },
    }
}

/// Suggested file extension for a Save-As of this content.
pub fn suggested_extension(c: &Classified) -> String {
    match c {
        Classified::Json(_) => "json".into(),
        Classified::Text(_) => "txt".into(),
        Classified::Binary { extension: Some(e), .. } => e.clone(),
        Classified::Binary { extension: None, .. } => "bin".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine as _;

    #[test]
    fn decodes_standard_with_padding() {
        assert_eq!(decode_lenient(&STANDARD.encode(b"hello")).unwrap(), b"hello");
    }

    #[test]
    fn decodes_url_safe_without_padding() {
        let raw = vec![0xfbu8, 0xff, 0xbf];
        let url = URL_SAFE_NO_PAD.encode(&raw); // contains '-' and '_'
        assert_eq!(decode_lenient(&url).unwrap(), raw);
    }

    #[test]
    fn strips_data_uri_prefix_and_interior_whitespace() {
        let json = STANDARD.encode(br#"{"a":1}"#);
        assert_eq!(decode_lenient(&format!("data:application/json;base64,{json}")).unwrap(), br#"{"a":1}"#);
        let wrapped = format!("{}\n {}", &json[..4], &json[4..]);
        assert_eq!(decode_lenient(&wrapped).unwrap(), br#"{"a":1}"#);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_lenient("not base64!!!").is_err());
        assert!(decode_lenient("   ").is_err());
    }

    #[test]
    fn classifies_json_text_and_binary() {
        assert_eq!(classify(br#"{"a":1}"#), Classified::Json(r#"{"a":1}"#.to_string()));
        assert_eq!(classify(b"hello world"), Classified::Text("hello world".to_string()));
        let png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        assert_eq!(
            classify(&png),
            Classified::Binary { mime: Some("image/png".into()), extension: Some("png".into()) }
        );
        let unknown = [0x00u8, 0x01, 0x02, 0xff, 0xfe];
        assert_eq!(classify(&unknown), Classified::Binary { mime: None, extension: None });
    }

    #[test]
    fn suggested_extension_per_kind() {
        assert_eq!(suggested_extension(&Classified::Json("{}".into())), "json");
        assert_eq!(suggested_extension(&Classified::Text("x".into())), "txt");
        assert_eq!(suggested_extension(&Classified::Binary { mime: Some("image/png".into()), extension: Some("png".into()) }), "png");
        assert_eq!(suggested_extension(&Classified::Binary { mime: None, extension: None }), "bin");
    }
}
```

- [ ] **Step 3: Register the module**

In `crates/handshaker-core/src/lib.rs`, add `pub mod base64;` to the module list (alphabetical, before `pub mod collections;`):

```rust
pub mod auth;
pub mod base64;
pub mod collections;
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `cargo test -p handshaker-core base64`
Expected: all 6 tests PASS (`decodes_standard_with_padding`, `decodes_url_safe_without_padding`, `strips_data_uri_prefix_and_interior_whitespace`, `rejects_garbage`, `classifies_json_text_and_binary`, `suggested_extension_per_kind`).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/base64/mod.rs crates/handshaker-core/src/lib.rs crates/handshaker-core/Cargo.toml Cargo.lock
git commit -m "feat(core): base64 decode + classify module"
```

---

## Task 2: IPC DTO + commands (`base64_inspect`, `base64_save`)

**Files:**
- Create: `src-tauri/src/ipc/base64.rs`
- Create: `src-tauri/src/commands/base64.rs`
- Modify: `src-tauri/src/ipc/mod.rs`, `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (use + collect_commands + plugin)
- Modify: `src-tauri/Cargo.toml` (tauri-plugin-dialog)
- Modify: `src-tauri/capabilities/default.json`
- Regenerate: `src/ipc/bindings.ts`

- [ ] **Step 1: Add the dialog plugin dependency**

Run: `cargo add tauri-plugin-dialog -p handshaker`
Expected: `tauri-plugin-dialog` under `[dependencies]` in `src-tauri/Cargo.toml`.

- [ ] **Step 2: Create the IPC DTO**

Create `src-tauri/src/ipc/base64.rs`:

```rust
//! IPC DTO for the base64 decoder. See
//! docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use handshaker_core::base64::Classified;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Base64KindIpc {
    Json,
    Text,
    Binary,
}

#[derive(Debug, Serialize, Type)]
pub struct Base64InspectIpc {
    pub kind: Base64KindIpc,
    /// Decoded byte length. specta rejects u64 in DTOs → u32 (responses ≪ 4 GB; saturating).
    pub size_bytes: u32,
    /// Decoded UTF-8 text for Json/Text; None for Binary.
    pub text: Option<String>,
    /// MIME for Binary (magic bytes); None otherwise.
    pub mime: Option<String>,
    /// Suggested extension for Binary; None otherwise.
    pub extension: Option<String>,
}

impl Base64InspectIpc {
    pub fn from_classified(size_bytes: u32, c: Classified) -> Self {
        match c {
            Classified::Json(s) => Self {
                kind: Base64KindIpc::Json,
                size_bytes,
                text: Some(s),
                mime: None,
                extension: None,
            },
            Classified::Text(s) => Self {
                kind: Base64KindIpc::Text,
                size_bytes,
                text: Some(s),
                mime: None,
                extension: None,
            },
            Classified::Binary { mime, extension } => Self {
                kind: Base64KindIpc::Binary,
                size_bytes,
                text: None,
                mime,
                extension,
            },
        }
    }
}
```

- [ ] **Step 3: Create the commands with a unit test**

Create `src-tauri/src/commands/base64.rs`:

```rust
//! Base64 decode IPC: inspect (view) + save (native Save-As). See
//! docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use handshaker_core::base64::{classify, decode_lenient, suggested_extension};

use crate::ipc::base64::Base64InspectIpc;

/// Testable core of `base64_inspect`. Err = input is not valid base64.
fn inspect_impl(input: &str) -> Result<Base64InspectIpc, String> {
    let bytes = decode_lenient(input)?;
    let size = bytes.len().min(u32::MAX as usize) as u32;
    Ok(Base64InspectIpc::from_classified(size, classify(&bytes)))
}

/// Decode a base64 string and report its kind/size/text (view-only).
#[tauri::command]
#[specta::specta]
pub async fn base64_inspect(input: String) -> Result<Base64InspectIpc, String> {
    inspect_impl(&input)
}

/// Decode a base64 string and write the bytes to a user-picked file.
/// Ok(Some(path)) = saved; Ok(None) = cancelled; Err = decode/write failure.
#[tauri::command]
#[specta::specta]
pub async fn base64_save(app: tauri::AppHandle, input: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let bytes = decode_lenient(&input)?;
    let ext = suggested_extension(&classify(&bytes));

    // Non-blocking save dialog from an async command: callback + oneshot.
    // (blocking_save_file must NOT run on the main thread.)
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(format!("decoded.{ext}"))
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::base64::Base64KindIpc;
    use base64::Engine as _;

    #[test]
    fn inspect_reports_json_kind_and_text() {
        let input = base64::engine::general_purpose::STANDARD.encode(br#"{"a":1}"#);
        let r = inspect_impl(&input).unwrap();
        assert!(matches!(r.kind, Base64KindIpc::Json));
        assert_eq!(r.text.as_deref(), Some(r#"{"a":1}"#));
        assert_eq!(r.size_bytes, 7);
    }

    #[test]
    fn inspect_errors_on_garbage() {
        assert!(inspect_impl("!!!").is_err());
    }
}
```

> Note: the test uses the `base64` crate directly. Add `base64` as a dev-dependency of `handshaker` if the test fails to resolve it: `cargo add base64 -p handshaker --dev`.

- [ ] **Step 4: Wire the modules**

In `src-tauri/src/ipc/mod.rs`, add `pub mod base64;` (after `pub mod auth;`):
```rust
pub mod auth;
pub mod base64;
pub mod catalog;
```

In `src-tauri/src/commands/mod.rs`, add `pub mod base64;` (after `pub mod auth;`):
```rust
pub mod auth;
pub mod base64;
pub mod collection;
```

In `src-tauri/src/lib.rs`:
- add the `use` (after the `auth` use line):
```rust
use commands::base64::{base64_inspect, base64_save};
```
- add both to `collect_commands![` (e.g. after `vars_resolve,`):
```rust
            vars_resolve,
            base64_inspect,
            base64_save,
```
- add the plugin in the `tauri::Builder` chain (after the clipboard plugin line):
```rust
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 5: Add the capability permission**

In `src-tauri/capabilities/default.json`, add `"dialog:allow-save"` to the `permissions` array (after `"clipboard-manager:allow-write-text"`):
```json
    "clipboard-manager:allow-write-text",
    "dialog:allow-save"
```
> If the build later reports an unknown permission (Rust-only dialog use may not require it), remove this line — the dialog is invoked from Rust, not JS.

- [ ] **Step 6: Build dist/ if needed, then compile + test the backend**

Run (only if `dist/` is missing — `generate_context!` needs it):
```bash
pnpm install
pnpm build
```
Then:
Run: `cargo test -p handshaker base64`
Expected: `inspect_reports_json_kind_and_text` and `inspect_errors_on_garbage` PASS; crate compiles (plugin + commands registered).

- [ ] **Step 7: Regenerate the TypeScript bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: prints `wrote …/src/ipc/bindings.ts`. Open `src/ipc/bindings.ts` and verify it now contains `base64Inspect`, `base64Save`, `Base64InspectIpc`, and `Base64KindIpc = "json" | "text" | "binary"`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ipc/base64.rs src-tauri/src/commands/base64.rs src-tauri/src/ipc/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/capabilities/default.json src/ipc/bindings.ts Cargo.lock
git commit -m "feat(ipc): base64_inspect + base64_save commands"
```

---

## Task 3: Frontend pure helpers (`looksLikeBase64`, `stringValueAtOffset`)

**Files:**
- Create: `src/features/bodyview/decode.ts`
- Create: `src/features/bodyview/decode.test.ts`
- Create: `src/features/bodyview/valueAtOffset.ts`
- Create: `src/features/bodyview/valueAtOffset.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/bodyview/decode.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { looksLikeBase64 } from "./decode";

describe("looksLikeBase64", () => {
  it("accepts standard and URL-safe base64", () => {
    expect(looksLikeBase64("aGVsbG8=")).toBe(true); // "hello"
    expect(looksLikeBase64("aGk=")).toBe(true);     // "hi" — short but valid
    expect(looksLikeBase64("a-b_c")).toBe(true);    // URL-safe alphabet
  });
  it("rejects strings shorter than 4 or with non-alphabet chars", () => {
    expect(looksLikeBase64("abc")).toBe(false);       // < 4
    expect(looksLikeBase64("hello world")).toBe(false); // space
    expect(looksLikeBase64(`{"a":1}`)).toBe(false);     // { } : "
    expect(looksLikeBase64("naïve?")).toBe(false);      // ï, ?
  });
});
```

Create `src/features/bodyview/valueAtOffset.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";
import { stringValueAtOffset } from "./valueAtOffset";

describe("stringValueAtOffset", () => {
  it("returns the full string value at an offset inside a string node", () => {
    const text = `{"k":"aGVsbG8="}`;
    const p = parseWithSpans(text)!;
    const off = text.indexOf("aGV");
    expect(stringValueAtOffset(p.tree, p.spans, off)).toBe("aGVsbG8=");
  });
  it("returns null for a non-string node", () => {
    const text = `{"n":42}`;
    const p = parseWithSpans(text)!;
    expect(stringValueAtOffset(p.tree, p.spans, text.indexOf("42"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm vitest run src/features/bodyview/decode.test.ts src/features/bodyview/valueAtOffset.test.ts`
Expected: FAIL — cannot import `./decode` / `./valueAtOffset` (modules don't exist).

- [ ] **Step 3: Implement the helpers**

Create `src/features/bodyview/decode.ts`:
```ts
// Standard + URL-safe alphabet, optional trailing padding. Whole-value gate
// for the Decode/Save context-menu items. No upper length bound — base64 may be
// short; the backend is the source of truth on whether it actually decodes.
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** True if the entire string could be base64 (length ≥ 4, alphabet-only). */
export function looksLikeBase64(s: string): boolean {
  return s.length >= 4 && BASE64_RE.test(s);
}
```

Create `src/features/bodyview/valueAtOffset.ts`:
```ts
import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";

/** Full string value of the innermost string node at `offset`, else null.
 *  Elided nodes keep the full value in the tree, so large base64 comes back whole. */
export function stringValueAtOffset(
  tree: JsonTree,
  spans: readonly ValueSpan[],
  offset: number,
): string | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  return node && node.kind === "string" ? (node.value as string) : null;
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm vitest run src/features/bodyview/decode.test.ts src/features/bodyview/valueAtOffset.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/decode.ts src/features/bodyview/decode.test.ts src/features/bodyview/valueAtOffset.ts src/features/bodyview/valueAtOffset.test.ts
git commit -m "feat(bodyview): base64 gate + value-at-offset helpers"
```

---

## Task 4: Client wrappers + byte-count formatter

**Files:**
- Modify: `src/ipc/client.ts` (add `base64Inspect`, `base64Save`)
- Modify: `src/lib/grpc-status.ts` (add `formatByteCount`, DRY `formatBytes`)
- Modify: `src/lib/grpc-status.test.ts` (if it exists) or create it

- [ ] **Step 1: Write the failing test for `formatByteCount`**

Create or append to `src/lib/grpc-status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatByteCount } from "./grpc-status";

describe("formatByteCount", () => {
  it("formats raw byte counts", () => {
    expect(formatByteCount(512)).toBe("512B");
    expect(formatByteCount(2048)).toBe("2.0KB");
    expect(formatByteCount(3 * 1024 * 1024)).toBe("3.0MB");
    expect(formatByteCount(-1)).toBe("0B");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/lib/grpc-status.test.ts`
Expected: FAIL — `formatByteCount` is not exported.

- [ ] **Step 3: Add `formatByteCount` and refactor `formatBytes`**

In `src/lib/grpc-status.ts`, replace the `formatBytes` function with:
```ts
/** Raw byte count formatted as `123B` / `1.2KB` / `3.4MB`. */
export function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * JSON byte size formatted as `123B` / `1.2KB` / `3.4MB` (UTF-8 byte length).
 */
export function formatBytes(s: string | null | undefined): string {
  if (s == null) return "0B";
  return formatByteCount(new TextEncoder().encode(s).length);
}
```

- [ ] **Step 4: Add the client wrappers**

In `src/ipc/client.ts`, add (near the other wrappers; the file already imports `commands`):
```ts
export async function base64Inspect(input: string): Promise<Base64InspectIpc> {
  const r = await commands.base64Inspect(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function base64Save(input: string): Promise<string | null> {
  const r = await commands.base64Save(input);
  if (r.status === "error") throw r.error;
  return r.data;
}
```
Add `Base64InspectIpc` to the existing type import from `@/ipc/bindings` at the top of `client.ts` (it imports binding types already — add `Base64InspectIpc` to that import list).

- [ ] **Step 5: Run tests + typecheck — verify pass**

Run: `pnpm vitest run src/lib/grpc-status.test.ts`
Expected: PASS.
Run: `pnpm lint`
Expected: tsc clean (the wrappers resolve `commands.base64Inspect`/`commands.base64Save` from the regenerated bindings).

- [ ] **Step 6: Commit**

```bash
git add src/ipc/client.ts src/lib/grpc-status.ts src/lib/grpc-status.test.ts
git commit -m "feat(ipc): client wrappers for base64 + byte-count formatter"
```

---

## Task 5: `DecodeDialog`

**Files:**
- Create: `src/features/response/DecodeDialog.tsx`
- Create: `src/features/response/DecodeDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/DecodeDialog.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="monaco">{value}</pre>,
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}], readPrefs: () => ({}) }));

const inspect = vi.fn();
const save = vi.fn();
vi.mock("@/ipc/client", () => ({
  base64Inspect: (...a: unknown[]) => inspect(...a),
  base64Save: (...a: unknown[]) => save(...a),
}));
const copy = vi.fn();
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (...a: unknown[]) => copy(...a) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import { DecodeDialog } from "./DecodeDialog";

beforeEach(() => {
  inspect.mockReset();
  save.mockReset();
  copy.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("DecodeDialog", () => {
  it("shows decoded JSON text and copies it", async () => {
    inspect.mockResolvedValue({ kind: "json", size_bytes: 7, text: `{"a":1}`, mime: null, extension: null });
    render(<DecodeDialog value="eyJhIjoxfQ==" onClose={vi.fn()} />);
    expect(await screen.findByText("JSON")).toBeInTheDocument();
    expect(screen.getByTestId("monaco").textContent).toContain(`{"a":1}`);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(copy).toHaveBeenCalledWith(`{"a":1}`, expect.anything());
  });

  it("shows a binary summary, no editor, and copies base64", async () => {
    inspect.mockResolvedValue({ kind: "binary", size_bytes: 253952, text: null, mime: "image/png", extension: "png" });
    render(<DecodeDialog value="iVBORw0KGgo=" onClose={vi.fn()} />);
    expect(await screen.findByText("image/png")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy base64/i }));
    expect(copy).toHaveBeenCalledWith("iVBORw0KGgo=", expect.anything());
  });

  it("calls base64Save with the original value on Save", async () => {
    inspect.mockResolvedValue({ kind: "text", size_bytes: 5, text: "hello", mime: null, extension: null });
    save.mockResolvedValue("/tmp/decoded.txt");
    render(<DecodeDialog value="aGVsbG8=" onClose={vi.fn()} />);
    await screen.findByText("Text");
    fireEvent.click(screen.getByRole("button", { name: /save to file/i }));
    expect(save).toHaveBeenCalledWith("aGVsbG8=");
  });

  it("toasts and closes when decode fails", async () => {
    inspect.mockRejectedValue("Not valid base64");
    const onClose = vi.fn();
    render(<DecodeDialog value="!!!" onClose={onClose} />);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/features/response/DecodeDialog.test.tsx`
Expected: FAIL — `./DecodeDialog` does not exist.

- [ ] **Step 3: Implement `DecodeDialog`**

Create `src/features/response/DecodeDialog.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { Copy, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BodyView } from "@/features/bodyview/BodyView";
import { base64Inspect, base64Save } from "@/ipc/client";
import { copyToClipboard } from "@/lib/clipboard";
import { formatByteCount } from "@/lib/grpc-status";
import type { Base64InspectIpc } from "@/ipc/bindings";
import { toast } from "sonner";

export interface DecodeDialogProps {
  /** Base64 string to decode; null = dialog closed. */
  value: string | null;
  onClose: () => void;
}

function kindLabel(info: Base64InspectIpc): string {
  if (info.kind === "json") return "JSON";
  if (info.kind === "text") return "Text";
  return info.mime ?? "Binary";
}

export function DecodeDialog({ value, onClose }: DecodeDialogProps) {
  // `current` is the base64 actually being inspected — starts as the prop value
  // but can drill INTO a nested base64 the user right-click→Decodes inside the
  // dialog (the inner BodyView is the same response-mode component). Resets when
  // the dialog is (re)opened with a new prop value.
  const [current, setCurrent] = useState<string | null>(value);
  const [info, setInfo] = useState<Base64InspectIpc | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (current === null) {
      setInfo(null);
      return;
    }
    let alive = true;
    setInfo(null);
    base64Inspect(current)
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch((e) => {
        if (!alive) return;
        toast.error(typeof e === "string" ? e : "Not valid base64");
        onCloseRef.current();
      });
    return () => {
      alive = false;
    };
  }, [current]);

  const isBinary = info?.kind === "binary";

  function handleCopy() {
    if (!info) return;
    if (isBinary) void copyToClipboard(current ?? "", "Copied base64");
    else void copyToClipboard(info.text ?? "", "Copied decoded text");
  }

  function handleSave() {
    if (current === null) return;
    void base64Save(current)
      .then((path) => {
        if (path) toast.success(`Saved to ${path}`);
      })
      .catch((e) => toast.error(typeof e === "string" ? e : "Couldn't save"));
  }

  return (
    <Dialog open={value !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[70vh] max-w-[640px] flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span>Decoded</span>
            {info && (
              <>
                <span className="rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                  {kindLabel(info)}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {formatByteCount(info.size_bytes)}
                </span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          {info && !isBinary && info.text !== null && (
            <BodyView mode="response" value={info.text} onDecode={setCurrent} />
          )}
          {info && isBinary && (
            <div className="flex items-center gap-2 p-4 font-mono text-xs text-muted-foreground">
              <span>{info.mime ?? "application/octet-stream"}</span>
              <span>· {formatByteCount(info.size_bytes)}</span>
            </div>
          )}
          {!info && <div className="p-4 text-xs text-muted-foreground">Decoding…</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCopy} disabled={!info}>
            <Copy className="size-3.5" />
            {isBinary ? "Copy base64" : "Copy"}
          </Button>
          <Button onClick={handleSave} disabled={current === null}>
            <Download className="size-3.5" />
            Save to file…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> The existing tests still hold: at the top level `current === value`, so Copy/Save target the same string and the JSON/Text/Binary assertions are unchanged. Drill-down (`onDecode={setCurrent}`) is exercised live (Monaco's `onMount` doesn't run under the test mock).

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run src/features/response/DecodeDialog.test.tsx`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/DecodeDialog.tsx src/features/response/DecodeDialog.test.tsx
git commit -m "feat(response): DecodeDialog"
```

---

## Task 6: `attachDecodeActions` (context-menu actions module)

**Files:**
- Create: `src/features/bodyview/decodeActions.ts`
- Create: `src/features/bodyview/decodeActions.test.ts`

- [ ] **Step 1: Write the failing test (fake editor)**

Create `src/features/bodyview/decodeActions.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { parseWithSpans } from "./parse";
import { attachDecodeActions, type DecodeEditorLike } from "./decodeActions";

// Minimal fake editor: single-line, offset = column - 1 (mirrors controller.test).
function fakeEditor(text: string, cursorOffset: number) {
  const runs: Record<string, (ed: DecodeEditorLike) => void> = {};
  let ctxValue = false;
  let ctxListener: ((e: { target: { position: { lineNumber: number; column: number } | null } }) => void) | null = null;
  let disposeCount = 0;
  const mkDisp = () => ({ dispose: () => { disposeCount += 1; } });
  const editor: DecodeEditorLike = {
    getModel: () => ({
      getOffsetAt: (pos) => pos.column - 1,
      getPositionAt: (off) => ({ lineNumber: 1, column: off + 1 }),
      setValue: () => {},
      getValueInRange: () => "",
    }),
    getPosition: () => ({ lineNumber: 1, column: cursorOffset + 1 }),
    createContextKey: (_k, def: boolean) => { ctxValue = def; return { set: (v) => { ctxValue = v; } }; },
    addAction: (a) => { runs[a.id] = a.run; return mkDisp(); },
    onContextMenu: (cb) => { ctxListener = cb; return mkDisp(); },
  };
  return {
    editor,
    run: (id: string) => runs[id]?.(editor),
    actionIds: () => Object.keys(runs),
    rightClickAt: (offset: number) => ctxListener?.({ target: { position: { lineNumber: 1, column: offset + 1 } } }),
    ctx: () => ctxValue,
    disposeCount: () => disposeCount,
  };
}

describe("attachDecodeActions", () => {
  const text = `{"k":"aGVsbG8="}`; // value "aGVsbG8=" is valid base64
  const p = parseWithSpans(text)!;
  const off = text.indexOf("aGV");

  function deps(extra?: Partial<Parameters<typeof attachDecodeActions>[1]>) {
    return {
      getTree: () => p.tree,
      getSpans: () => p.spans,
      onDecode: vi.fn(),
      onCopy: vi.fn(),
      onSave: vi.fn(),
      ...extra,
    };
  }

  it("registers the three actions", () => {
    const f = fakeEditor(text, off);
    attachDecodeActions(f.editor, deps());
    expect(f.actionIds()).toEqual(
      expect.arrayContaining(["hs.decodeBase64", "hs.copyValue", "hs.saveDecoded"]),
    );
  });

  it("Decode/Copy/Save run with the value under the cursor", () => {
    const f = fakeEditor(text, off);
    const d = deps();
    attachDecodeActions(f.editor, d);
    f.run("hs.decodeBase64");
    f.run("hs.copyValue");
    f.run("hs.saveDecoded");
    expect(d.onDecode).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onCopy).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onSave).toHaveBeenCalledWith("aGVsbG8=");
  });

  it("sets the gate key true over a base64 value, false elsewhere", () => {
    const f = fakeEditor(text, off);
    attachDecodeActions(f.editor, deps());
    f.rightClickAt(off);
    expect(f.ctx()).toBe(true);
    f.rightClickAt(text.indexOf('"k"')); // the key, not base64-ish enough / not a string value span
    expect(f.ctx()).toBe(false);
  });

  it("sets the gate key false over a non-base64 string", () => {
    const t2 = `{"k":"hi"}`; // "hi" is < 4 chars
    const p2 = parseWithSpans(t2)!;
    const f = fakeEditor(t2, t2.indexOf("hi"));
    attachDecodeActions(f.editor, { getTree: () => p2.tree, getSpans: () => p2.spans, onDecode: vi.fn(), onCopy: vi.fn(), onSave: vi.fn() });
    f.rightClickAt(t2.indexOf("hi"));
    expect(f.ctx()).toBe(false);
  });

  it("disposes every registration", () => {
    const f = fakeEditor(text, off);
    const handle = attachDecodeActions(f.editor, deps());
    handle.dispose();
    expect(f.disposeCount()).toBe(4); // 3 actions + 1 context-menu listener
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/features/bodyview/decodeActions.test.ts`
Expected: FAIL — `./decodeActions` does not exist.

- [ ] **Step 3: Implement `attachDecodeActions`**

Create `src/features/bodyview/decodeActions.ts`:
```ts
import type { DisposableLike, ModelLike, PositionLike } from "./editorLike";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { stringValueAtOffset } from "./valueAtOffset";
import { looksLikeBase64 } from "./decode";

export interface ContextKeyLike {
  set(value: boolean): void;
}

export interface DecodeActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  precondition?: string;
  run(editor: DecodeEditorLike): void;
}

/** Structural slice of Monaco's IStandaloneCodeEditor used by the decode actions. */
export interface DecodeEditorLike {
  getModel(): ModelLike | null;
  getPosition(): PositionLike | null;
  createContextKey<T>(key: string, defaultValue: T): ContextKeyLike;
  addAction(descriptor: DecodeActionDescriptor): DisposableLike;
  onContextMenu(listener: (e: { target: { position: PositionLike | null } }) => void): DisposableLike;
}

export interface DecodeActionDeps {
  getTree(): JsonTree | null;
  getSpans(): readonly ValueSpan[];
  /** Open the decode dialog for this whole value. */
  onDecode(value: string): void;
  /** Copy the raw string value. */
  onCopy(value: string): void;
  /** Decode + native Save-As of this whole value. */
  onSave(value: string): void;
}

const GROUP = "9_cutcopypaste";
const KEY = "hsValueIsB64";

function valueAtCursor(editor: DecodeEditorLike, deps: DecodeActionDeps): string | null {
  const model = editor.getModel();
  const pos = editor.getPosition();
  const tree = deps.getTree();
  if (!model || !pos || !tree) return null;
  return stringValueAtOffset(tree, deps.getSpans(), model.getOffsetAt(pos));
}

/**
 * Register the response-body context-menu actions (Decode / Copy value / Save
 * decoded to file…). Actions carry NO keybinding — only `contextMenuGroupId` —
 * so Monaco's global (last-wins) keybinding registry is never touched. Decode and
 * Save are gated by the `hsValueIsB64` context key, recomputed on each right-click.
 */
export function attachDecodeActions(editor: DecodeEditorLike, deps: DecodeActionDeps): DisposableLike {
  const gate = editor.createContextKey<boolean>(KEY, false);

  const ctxSub = editor.onContextMenu((e) => {
    const model = editor.getModel();
    const pos = e.target.position;
    const tree = deps.getTree();
    if (!model || !pos || !tree) {
      gate.set(false);
      return;
    }
    const v = stringValueAtOffset(tree, deps.getSpans(), model.getOffsetAt(pos));
    gate.set(!!v && looksLikeBase64(v));
  });

  const decode = editor.addAction({
    id: "hs.decodeBase64",
    label: "Decode base64",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3,
    precondition: KEY,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onDecode(v);
    },
  });

  const copy = editor.addAction({
    id: "hs.copyValue",
    label: "Copy value",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.1,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onCopy(v);
    },
  });

  const save = editor.addAction({
    id: "hs.saveDecoded",
    label: "Save decoded to file…",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.2,
    precondition: KEY,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onSave(v);
    },
  });

  return {
    dispose() {
      decode.dispose();
      copy.dispose();
      save.dispose();
      ctxSub.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run src/features/bodyview/decodeActions.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/decodeActions.ts src/features/bodyview/decodeActions.test.ts
git commit -m "feat(bodyview): decode context-menu actions module"
```

---

## Task 7: Wire actions + dialog into `BodyView` / `ResponseBody`

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Modify: `src/features/response/ResponseBody.tsx`
- Modify: `src/features/response/ResponseBody.test.tsx` (create if absent)

- [ ] **Step 1: Add the `onDecode` prop + imports to `BodyView`**

In `src/features/bodyview/BodyView.tsx`:

Add imports (top of file, with the other feature imports):
```ts
import { attachDecodeActions, type DecodeEditorLike } from "./decodeActions";
import { copyToClipboard } from "@/lib/clipboard";
import { toastSnippet } from "./copyValue";
import { base64Save } from "@/ipc/client";
import { toast } from "sonner";
```

Add `onDecode` to `BodyViewProps`:
```ts
  /** Response mode only: open the base64 decode dialog for a value. */
  onDecode?: (value: string) => void;
```

Add `decode` to the `Live` interface (next to `controller`):
```ts
  decode: DisposableLike | null;
```

Destructure the prop and add a ref (next to the `onSubmitRef` block):
```ts
export function BodyView({ mode, value, onChange, onSubmit, onDecode, schema }: BodyViewProps) {
```
```ts
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
```

- [ ] **Step 2: Initialise and dispose the `decode` field**

In `onMount`, in the teardown block at the top, add disposal of a prior decode handle (next to `live.current?.controller?.dispose();`):
```ts
      live.current?.decode?.dispose();
```
In the `live.current = { ... }` object literal, add the field (next to `controller: null,`):
```ts
        decode: null,
```
In the unmount `useEffect` (the one that disposes `controller`/`typeSub`/`ghost`), add:
```ts
    live.current?.decode?.dispose();
```

- [ ] **Step 3: Register the actions in response mode**

In `onMount`, inside the existing `if (mode === "response") { renderResponse(editor.getValue()); }` block, after `renderResponse(...)`, add:
```ts
        live.current.decode = attachDecodeActions(editor as unknown as DecodeEditorLike, {
          getTree: () => live.current?.tree ?? null,
          getSpans: () => live.current?.spans ?? [],
          onDecode: (v) => onDecodeRef.current?.(v),
          onCopy: (v) => {
            void copyToClipboard(v, `Copied: ${toastSnippet(v)}`);
          },
          onSave: (v) => {
            void base64Save(v)
              .then((p) => {
                if (p) toast.success(`Saved to ${p}`);
              })
              .catch((e) => toast.error(typeof e === "string" ? e : "Couldn't save"));
          },
        });
```

- [ ] **Step 4: Wire `ResponseBody` to own the dialog**

Replace `src/features/response/ResponseBody.tsx` with:
```tsx
import { useState } from "react";
import { BodyView } from "@/features/bodyview/BodyView";
import { DecodeDialog } from "./DecodeDialog";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView,
 *  plus a base64 decode dialog driven by the body's context menu. */
export function ResponseBody({ json }: ResponseBodyProps) {
  const [decodeValue, setDecodeValue] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} onDecode={setDecodeValue} />
      <DecodeDialog value={decodeValue} onClose={() => setDecodeValue(null)} />
    </div>
  );
}
```

- [ ] **Step 5: Write a smoke test for the wiring**

Create `src/features/response/ResponseBody.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="monaco">{value}</pre>,
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}], readPrefs: () => ({}) }));
vi.mock("@/ipc/client", () => ({ base64Inspect: vi.fn(), base64Save: vi.fn() }));

import { ResponseBody } from "./ResponseBody";

describe("ResponseBody", () => {
  it("renders the body and no decode dialog initially", () => {
    render(<ResponseBody json={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").textContent).toContain(`{"a":1}`);
    expect(screen.queryByText("Decoded")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `pnpm test`
Expected: all tests PASS (a new export in `BodyView`/`client` can break partial `vi.mock`s — run the FULL suite, not a single file).
Run: `pnpm lint`
Expected: tsc clean.
Run: `pnpm build`
Expected: vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/response/ResponseBody.tsx src/features/response/ResponseBody.test.tsx
git commit -m "feat(response): wire decode actions + dialog into BodyView/ResponseBody"
```

---

## Final gate (run once after Task 7)

- [ ] `cargo test --workspace` — Rust green.
- [ ] `pnpm test` — vitest green.
- [ ] `pnpm lint` — tsc clean.
- [ ] `pnpm build` — vite build green.
- [ ] `git status` — `src/ipc/bindings.ts` committed (Task 2); no stray changes.

## Live-проход (manual, WebView2 — after the gate)

Invoke a gRPC method whose response has a `bytes` (or string) field carrying base64:
- nested JSON → right-click → **Decode base64** shows pretty-JSON; **Copy** copies it; **Save to file…** writes `decoded.json`;
- plain text → chip `Text`;
- PNG/binary → chip shows the type, **Save to file…** writes a valid file;
- verify URL-safe base64 decodes; **Save** cancel returns cleanly (no error toast); **Decode** is hidden on a non-base64 value (e.g. a short id) and shown on a base64 one.

---

## Self-review (filled in by the plan author)

**Spec coverage:** trigger on any whole string value (Task 6/7) · whole-value, no substring (Task 6 `valueAtCursor`) · charset gate no length cap (Task 3) · decode lenient std+url-safe+padding (Task 1) · UTF-8/JSON/binary classify + magic bytes (Task 1) · `base64_inspect`/`base64_save` (Task 2) · native Save-As via tauri-plugin-dialog (Task 2) · dialog reuses BodyView, Copy/Save buttons (Task 5) · Monaco action without keybinding, response-mode only, gate key (Task 6/7) · bindings regen tracked (Task 2) · clipboard reuse (Task 7) · capability (Task 2). All covered.

**Placeholder scan:** none — every step carries full code/commands.

**Type consistency:** `Classified` (Json/Text/Binary{mime,extension}) consistent core↔`from_classified`↔DTO. `Base64InspectIpc` fields (`kind`/`size_bytes`/`text`/`mime`/`extension`) match the dialog's reads. `looksLikeBase64`/`stringValueAtOffset`/`attachDecodeActions` signatures consistent across Tasks 3/6/7. `base64Inspect`/`base64Save` wrapper names match `commands.base64Inspect`/`base64Save` (specta camelCase) and the dialog imports.
