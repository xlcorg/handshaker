# Save Response Body to File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user save the full pretty-printed gRPC response body to a file via a context-menu item, a header icon, and Ctrl/Cmd+S — with a "Show in folder" toast on success.

**Architecture:** A generic Rust `file_save_text(text, default_name)` IPC command reuses the existing native Save-As dialog helper (extracted from `commands/base64.rs` into `commands/dialog.rs`). The frontend builds the filename (`<method>-<localstamp>.json`) with a pure function, orchestrates save + toast in one helper that all three surfaces call, and reveals the saved file with the new `tauri-plugin-opener`.

**Tech Stack:** Rust / Tauri 2 (`tauri-plugin-dialog`, new `tauri-plugin-opener`), tauri-specta bindings, React 18 + TypeScript, Monaco, sonner toasts, vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-save-response-to-file-design.md`

---

## File Structure

**Backend (Rust):**
- Create `src-tauri/src/commands/dialog.rs` — shared `save_bytes_via_dialog` helper + `file_save_text` command.
- Modify `src-tauri/src/commands/mod.rs` — register the `dialog` module.
- Modify `src-tauri/src/commands/base64.rs` — drop the local dialog helper, import it from `dialog`.
- Modify `src-tauri/src/lib.rs` — import + register `file_save_text`; add the opener plugin.
- Modify `Cargo.toml` + `src-tauri/Cargo.toml` — add `tauri-plugin-opener`.
- Modify `src-tauri/capabilities/default.json` — add the opener reveal permission.

**Frontend:**
- Modify `src/ipc/bindings.ts` — regenerated (adds `fileSaveText`).
- Modify `src/ipc/client.ts` — `fileSaveText` wrapper.
- Create `src/features/response/responseFileName.ts` — pure filename builder.
- Create `src/features/response/saveHotkey.ts` — pure `isSaveResponseHotkey` predicate.
- Create `src/features/response/saveResponse.ts` — save + toast + reveal orchestrator.
- Create `src/features/bodyview/saveAction.ts` — Monaco context-menu action.
- Modify `src/lib/messages.ts` — `response.save.*` copy.
- Modify `src/features/bodyview/BodyView.tsx` — thread `onSaveBody`, attach the action.
- Modify `src/features/response/ResponseBody.tsx` — forward `onSaveBody`.
- Modify `src/features/response/ResponsePanel.tsx` — header icon + hotkey + `method` prop.
- Modify `src/features/workflow/CallPanel.tsx` — pass `method={step.method}`.
- Modify `package.json` — add `@tauri-apps/plugin-opener`.

---

## Task 1: Backend — generic `file_save_text` command

**Files:**
- Create: `src-tauri/src/commands/dialog.rs`
- Modify: `src-tauri/src/commands/mod.rs:4` (insert module line)
- Modify: `src-tauri/src/commands/base64.rs:22-57` (remove local helper) + imports
- Modify: `src-tauri/src/lib.rs:8` (import) and `:50-52` (collect_commands)

- [ ] **Step 1: Create the dialog module**

Create `src-tauri/src/commands/dialog.rs`:

```rust
//! Generic native Save-As dialog helpers shared across commands.

/// Open a native Save-As dialog and write `bytes` to the chosen file.
/// Ok(Some(path)) = saved; Ok(None) = cancelled; Err = dialog/write failure.
///
/// Async-command-safe: a non-blocking dialog (callback + oneshot) rather than
/// `blocking_save_file`, which must NOT run on the main thread.
///
/// No extension filter is set on purpose: the content is arbitrary, and on macOS
/// a filter LOCKS the extension (`NSSavePanel` greys out other types and
/// force-appends the filter's first extension). `default_name` carries the
/// suggested extension as a suggestion, not a cage.
pub(crate) async fn save_bytes_via_dialog(
    app: &tauri::AppHandle,
    default_name: &str,
    bytes: &[u8],
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Write arbitrary UTF-8 `text` (verbatim — no newline transformation) to a
/// user-picked file via the native Save-As dialog. Ok(Some(path)) = saved;
/// Ok(None) = cancelled; Err = dialog/write failure.
#[tauri::command]
#[specta::specta]
pub async fn file_save_text(
    app: tauri::AppHandle,
    text: String,
    default_name: String,
) -> Result<Option<String>, String> {
    save_bytes_via_dialog(&app, &default_name, text.as_bytes()).await
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/commands/mod.rs`, add the module line in alphabetical order (after `collection`):

```rust
pub mod collection;
pub mod dialog;
pub mod env;
```

- [ ] **Step 3: Point base64 at the shared helper**

In `src-tauri/src/commands/base64.rs`, DELETE the entire local `save_bytes_via_dialog` function (its doc comment + body, currently lines 22-57). Then add this import near the top, just below the existing `use handshaker_core::base64::...` line:

```rust
use crate::commands::dialog::save_bytes_via_dialog;
```

`base64_save` / `base64_save_encoded` keep calling `save_bytes_via_dialog(&app, …)` unchanged — they now resolve to the imported helper.

- [ ] **Step 4: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, add the import next to the base64 import (line 8):

```rust
use commands::base64::{base64_inspect, base64_save, base64_save_encoded};
use commands::dialog::file_save_text;
```

And add it to `collect_commands![` right after `base64_save_encoded,` (line 52):

```rust
            base64_inspect,
            base64_save,
            base64_save_encoded,
            file_save_text,
```

- [ ] **Step 5: Verify it compiles and existing tests pass**

Run: `cargo test --workspace`
Expected: builds cleanly, all existing tests pass (no new Rust test — the dialog path needs UI and isn't unit-testable, matching base64 which only tests `inspect_impl`).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/dialog.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/base64.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): generic file_save_text command + shared Save-As dialog helper"
```

---

## Task 2: Add `tauri-plugin-opener` (for "Show in folder")

**Files:**
- Modify: `Cargo.toml:55-65` (workspace deps)
- Modify: `src-tauri/Cargo.toml` (plugin dep — next to other `tauri-plugin-*`)
- Modify: `src-tauri/src/lib.rs:113-117` (plugin init)
- Modify: `src-tauri/capabilities/default.json:18` (permission)
- Modify: `package.json:29` (npm dep)

- [ ] **Step 1: Add the Rust workspace dependency**

In the root `Cargo.toml`, under `[workspace.dependencies]`, add next to the other Tauri plugins (after `tauri-plugin-dialog = "2"`):

```toml
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
```

- [ ] **Step 2: Reference it from the app crate**

In `src-tauri/Cargo.toml`, in the same block as the other `tauri-plugin-*` entries (around line 35-38), add:

```toml
tauri-plugin-opener = { workspace = true }
```

- [ ] **Step 3: Initialize the plugin**

In `src-tauri/src/lib.rs`, add to the plugin chain (after `.plugin(tauri_plugin_dialog::init())`, line 116):

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
```

- [ ] **Step 4: Grant the reveal permission**

In `src-tauri/capabilities/default.json`, add to the `"permissions"` array (after `"dialog:allow-save"`):

```json
    "dialog:allow-save",
    "opener:allow-reveal-item-in-dir"
```

- [ ] **Step 5: Add the JS plugin package**

In `package.json` `dependencies`, add (after `@tauri-apps/plugin-dialog`):

```json
    "@tauri-apps/plugin-opener": "^2",
```

Then run: `pnpm install`
Expected: resolves and installs `@tauri-apps/plugin-opener`.

- [ ] **Step 6: Verify the Rust side builds**

Run: `cargo build -p handshaker`
Expected: builds with the opener plugin linked.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml
git commit -m "feat(deps): add tauri-plugin-opener for reveal-in-folder"
```

---

## Task 3: Regenerate bindings + `fileSaveText` client wrapper

**Files:**
- Modify: `src/ipc/bindings.ts` (regenerated — git-tracked)
- Modify: `src/ipc/client.ts:313-361`

- [ ] **Step 1: Regenerate the TypeScript bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: rewrites `src/ipc/bindings.ts`; the only diff is a new `fileSaveText` method on `commands` and any reordering. Confirm with `git diff --stat src/ipc/bindings.ts`.

- [ ] **Step 2: Add the client wrapper**

In `src/ipc/client.ts`, add after `base64SaveEncoded` (line 317):

```ts
export async function fileSaveText(text: string, defaultName: string): Promise<string | null> {
  const r = await commands.fileSaveText(text, defaultName);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

And add it to the `ipc` object (after `base64SaveEncoded,`, line 360):

```ts
  base64Save,
  base64SaveEncoded,
  fileSaveText,
};
```

- [ ] **Step 3: Verify types**

Run: `pnpm lint`
Expected: `tsc -b` passes (the regenerated `commands.fileSaveText` is typed).

- [ ] **Step 4: Commit**

```bash
git add src/ipc/bindings.ts src/ipc/client.ts
git commit -m "feat(ipc): regen bindings + fileSaveText client wrapper"
```

---

## Task 4: Pure `responseFileName` builder (TDD)

**Files:**
- Create: `src/features/response/responseFileName.ts`
- Test: `src/features/response/responseFileName.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/responseFileName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { responseFileName } from "./responseFileName";

// Local-time constructor: 2026-06-30 15:30:12 (month is 0-based → 5 = June).
const FIXED = new Date(2026, 5, 30, 15, 30, 12);

describe("responseFileName", () => {
  it("uses the method name + local timestamp", () => {
    expect(responseFileName("GetUser", FIXED)).toBe("GetUser-2026-06-30T15-30-12.json");
  });

  it("falls back to 'response' when the method is empty", () => {
    expect(responseFileName("", FIXED)).toBe("response-2026-06-30T15-30-12.json");
  });

  it("falls back to 'response' when the method is whitespace-only", () => {
    expect(responseFileName("   ", FIXED)).toBe("response-2026-06-30T15-30-12.json");
  });

  it("strips filename-unsafe characters from the method", () => {
    expect(responseFileName("My/Method!", FIXED)).toBe("MyMethod-2026-06-30T15-30-12.json");
  });

  it("zero-pads single-digit date/time components", () => {
    const d = new Date(2026, 0, 5, 9, 8, 7); // 2026-01-05 09:08:07
    expect(responseFileName("M", d)).toBe("M-2026-01-05T09-08-07.json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- responseFileName`
Expected: FAIL — `responseFileName` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/response/responseFileName.ts`:

```ts
/** Filesystem-safe timestamp `YYYY-MM-DDTHH-MM-SS` in LOCAL time (colons → `-`). */
function localStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

/** Default Save-As filename for a response body: `<method>-<localstamp>.json`,
 *  falling back to `response-<localstamp>.json` when the method is blank. The
 *  method is sanitized to filename-safe chars. Pure — deterministic given `now`. */
export function responseFileName(method: string, now: Date): string {
  const safe = method.replace(/[^A-Za-z0-9_-]/g, "");
  const base = safe.length > 0 ? safe : "response";
  return `${base}-${localStamp(now)}.json`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- responseFileName`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/responseFileName.ts src/features/response/responseFileName.test.ts
git commit -m "feat(response): pure responseFileName builder"
```

---

## Task 5: Pure `isSaveResponseHotkey` predicate (TDD)

**Files:**
- Create: `src/features/response/saveHotkey.ts`
- Test: `src/features/response/saveHotkey.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/saveHotkey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isSaveResponseHotkey } from "./saveHotkey";

type E = Parameters<typeof isSaveResponseHotkey>[0];
const ev = (over: Partial<E>): E => ({
  code: "KeyS", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
});

describe("isSaveResponseHotkey", () => {
  it("Ctrl+S is the hotkey on Windows/Linux", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true }), false)).toBe(true);
  });
  it("Cmd+S is the hotkey on macOS", () => {
    expect(isSaveResponseHotkey(ev({ metaKey: true }), true)).toBe(true);
  });
  it("Ctrl+S does NOT fire on macOS", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true }), true)).toBe(false);
  });
  it("Cmd+S does NOT fire on Windows/Linux", () => {
    expect(isSaveResponseHotkey(ev({ metaKey: true }), false)).toBe(false);
  });
  it("AltGr (ctrl+alt) does NOT fire", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });
  it("Shift+Ctrl+S does NOT fire", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });
  it("matches by physical key — a non-KeyS code never fires", () => {
    expect(isSaveResponseHotkey(ev({ code: "KeyD", ctrlKey: true }), false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- saveHotkey`
Expected: FAIL — `isSaveResponseHotkey` is not defined.

- [ ] **Step 3: Write the implementation**

Create `src/features/response/saveHotkey.ts`:

```ts
/** Predicate for the Save-response hotkey: Ctrl+S (Windows/Linux) or Cmd+S
 *  (macOS), matched by PHYSICAL key (`e.code === "KeyS"`) so it is
 *  layout-independent. Guards: no Shift, no Alt (also excludes AltGr =
 *  Ctrl+Alt), and only the platform's primary modifier. `mac` is passed by the
 *  caller (which reads `isMacOS`) so the predicate stays pure and testable on
 *  both platforms. */
export function isSaveResponseHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyS" || e.shiftKey || e.altKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- saveHotkey`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/saveHotkey.ts src/features/response/saveHotkey.test.ts
git commit -m "feat(response): pure isSaveResponseHotkey predicate (Ctrl/Cmd+S)"
```

---

## Task 6: Save copy + `saveResponse` orchestrator (TDD)

**Files:**
- Modify: `src/lib/messages.ts:98-102` (extend `response`)
- Create: `src/features/response/saveResponse.ts`
- Test: `src/features/response/saveResponse.test.ts`

- [ ] **Step 1: Add the user-facing copy**

In `src/lib/messages.ts`, replace the existing `response` block (lines 98-102) with:

```ts
  response: {
    error: {
      noDetails: "No google.rpc details attached.",
    },
    save: {
      /** Context-menu item — trailing ellipsis signals a dialog opens. */
      toFileMenu: "Save response to file…",
      /** Header-icon tooltip — no ellipsis. */
      toFileTooltip: "Save response to file",
      /** Success-toast action button (reveal-in-folder). */
      showInFolder: "Show in folder",
      savedTo: (path: string) => `Saved to ${path}`,
      failed: "Couldn't save",
    },
  },
```

- [ ] **Step 2: Write the failing test**

Create `src/features/response/saveResponse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({ fileSaveText: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fileSaveText } from "@/ipc/client";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { saveResponseToFile } from "./saveResponse";

const mFileSaveText = vi.mocked(fileSaveText);
const mReveal = vi.mocked(revealItemInDir);
const mSuccess = vi.mocked(toast.success);
const mError = vi.mocked(toast.error);

beforeEach(() => vi.clearAllMocks());

describe("saveResponseToFile", () => {
  it("on success toasts with a 'Show in folder' action that reveals the file", async () => {
    mFileSaveText.mockResolvedValue("C:/out/GetUser.json");
    await saveResponseToFile(`{"a":1}`, "GetUser");

    // The body + a method-derived default name reached the IPC.
    expect(mFileSaveText).toHaveBeenCalledTimes(1);
    const [text, name] = mFileSaveText.mock.calls[0];
    expect(text).toBe(`{"a":1}`);
    expect(name).toMatch(/^GetUser-.*\.json$/);

    // Success toast carries the path and a reveal action.
    expect(mSuccess).toHaveBeenCalledTimes(1);
    const [msg, opts] = mSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toContain("C:/out/GetUser.json");
    expect(opts.action.label).toBe("Show in folder");
    opts.action.onClick();
    expect(mReveal).toHaveBeenCalledWith("C:/out/GetUser.json");
  });

  it("stays silent when the user cancels (null path)", async () => {
    mFileSaveText.mockResolvedValue(null);
    await saveResponseToFile("{}", "GetUser");
    expect(mSuccess).not.toHaveBeenCalled();
    expect(mError).not.toHaveBeenCalled();
  });

  it("error-toasts the failure message", async () => {
    mFileSaveText.mockRejectedValue("disk full");
    await saveResponseToFile("{}", "GetUser");
    expect(mError).toHaveBeenCalledWith("disk full");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- saveResponse`
Expected: FAIL — `saveResponseToFile` is not defined.

- [ ] **Step 4: Write the implementation**

Create `src/features/response/saveResponse.ts`:

```ts
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fileSaveText } from "@/ipc/client";
import { messages } from "@/lib/messages";
import { responseFileName } from "./responseFileName";

/** Save the full response body `text` to a user-picked file. Builds a default
 *  filename from `method` + a local timestamp, opens the native Save-As, and on
 *  success shows a toast with a "Show in folder" action (reveal-in-folder).
 *  Cancellation is silent; failure shows an error toast. Returns the promise so
 *  callers can await in tests; UI call sites fire-and-forget with `void`. */
export function saveResponseToFile(text: string, method: string): Promise<void> {
  const defaultName = responseFileName(method, new Date());
  return fileSaveText(text, defaultName)
    .then((path) => {
      if (!path) return; // cancelled
      toast.success(messages.response.save.savedTo(path), {
        action: {
          label: messages.response.save.showInFolder,
          onClick: () => void revealItemInDir(path),
        },
      });
    })
    .catch((e) => {
      toast.error(typeof e === "string" ? e : messages.response.save.failed);
    });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- saveResponse`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/messages.ts src/features/response/saveResponse.ts src/features/response/saveResponse.test.ts
git commit -m "feat(response): saveResponseToFile orchestrator + copy"
```

---

## Task 7: Monaco context-menu action `attachSaveResponseAction` (TDD)

**Files:**
- Create: `src/features/bodyview/saveAction.ts`
- Test: `src/features/bodyview/saveAction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/bodyview/saveAction.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { attachSaveResponseAction, type SaveMenuEditor } from "./saveAction";
import { messages } from "@/lib/messages";

function mockMenuEditor() {
  const descriptors: { id: string; label: string; contextMenuGroupId?: string; contextMenuOrder?: number; run(): void }[] = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const addAction = vi.fn((d: (typeof descriptors)[number]) => {
    descriptors.push(d);
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  });
  return { editor: { addAction } as unknown as SaveMenuEditor, descriptors, disposers };
}

describe("attachSaveResponseAction", () => {
  it("registers a 'Save response to file…' context-menu action", () => {
    const m = mockMenuEditor();
    attachSaveResponseAction(m.editor, vi.fn());
    expect(m.descriptors).toHaveLength(1);
    expect(m.descriptors[0].id).toBe("hs.saveResponse");
    expect(m.descriptors[0].label).toBe(messages.response.save.toFileMenu);
    expect(m.descriptors[0].contextMenuGroupId).toBe("1_folding");
  });

  it("run() invokes the save callback", () => {
    const m = mockMenuEditor();
    const onSave = vi.fn();
    attachSaveResponseAction(m.editor, onSave);
    m.descriptors[0].run();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes the action", () => {
    const m = mockMenuEditor();
    attachSaveResponseAction(m.editor, vi.fn()).dispose();
    expect(m.disposers[0]).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- saveAction`
Expected: FAIL — `attachSaveResponseAction` is not defined.

- [ ] **Step 3: Write the implementation**

Create `src/features/bodyview/saveAction.ts`:

```ts
import type { DisposableLike } from "./editorLike";
import { messages } from "@/lib/messages";

interface SaveActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  run(): void;
}

/** Editor surface needed to register the save action. The real
 *  `IStandaloneCodeEditor` satisfies this (it has `addAction`). */
export interface SaveMenuEditor {
  addAction(descriptor: SaveActionDescriptor): DisposableLike;
}

// Same group as Collapse/Expand all ("1_folding"), ordered after them (order 3),
// so "Save response to file…" sits with the document-wide actions at the top.
const GROUP_FOLDING = "1_folding";

/** Register "Save response to file…" as a document-wide right-click action in the
 *  response editor. No precondition (always available) and NO keybinding — the
 *  Ctrl/Cmd+S hotkey is handled at the panel level (Monaco `addCommand` is global
 *  last-wins, so binding a key here would clobber the request editor). `onSave`
 *  saves the FULL response body. Returns a disposable that removes the action. */
export function attachSaveResponseAction(editor: SaveMenuEditor, onSave: () => void): DisposableLike {
  return editor.addAction({
    id: "hs.saveResponse",
    label: messages.response.save.toFileMenu,
    contextMenuGroupId: GROUP_FOLDING,
    contextMenuOrder: 3,
    run: () => onSave(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- saveAction`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/saveAction.ts src/features/bodyview/saveAction.test.ts
git commit -m "feat(bodyview): Save-response-to-file context-menu action"
```

---

## Task 8: Thread `onSaveBody` through BodyView + ResponseBody

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx` (prop, ref, Live field, attach, dispose)
- Modify: `src/features/response/ResponseBody.tsx` (forward the prop)

- [ ] **Step 1: Add the prop + ref to BodyView**

In `src/features/bodyview/BodyView.tsx`, add to `BodyViewProps` (after `varCandidates`, line 45):

```ts
  /** Variable candidates for `{{`-autocomplete — request mode only. */
  varCandidates?: VarCandidate[];
  /** Response mode only: save the FULL body to a file (context-menu action). */
  onSaveBody?: () => void;
```

Update the destructure (line 78):

```ts
export function BodyView({ mode, value, onChange, onSubmit, schema, varCandidates, onSaveBody }: BodyViewProps) {
```

Add the ref next to `onSubmitRef` (after line 87):

```ts
  const onSaveBodyRef = useRef(onSaveBody);
  onSaveBodyRef.current = onSaveBody;
```

- [ ] **Step 2: Add the Live field + import**

Add the import next to the other action imports (after line 26, `attachFoldActions`):

```ts
import { attachSaveResponseAction, type SaveMenuEditor } from "./saveAction";
```

In the `Live` interface, add after `fold` (line 59):

```ts
  /** Collapse/Expand-all context-menu actions (response only). */
  fold: DisposableLike | null;
  /** Save-response-to-file context-menu action (response only). */
  save: DisposableLike | null;
```

In the `live.current = { … }` initializer (line 234), add `save: null,`:

```ts
        decorations: null, expanded: new Set(), controller: null, decode: null, fold: null, save: null, wrap: null, ctxMenu: null, typeSub: null,
```

- [ ] **Step 3: Attach the action + dispose it**

In the onMount teardown block, add after `live.current?.fold?.dispose();` (line 227):

```ts
      live.current?.fold?.dispose();
      live.current?.save?.dispose();
```

In the response branch, right after the fold attach (`live.current.fold = attachFoldActions(...)`, line 351), add:

```ts
        live.current.fold = attachFoldActions(editor as unknown as FoldMenuEditor);
        live.current.save = attachSaveResponseAction(
          editor as unknown as SaveMenuEditor,
          () => onSaveBodyRef.current?.(),
        );
```

In the unmount cleanup effect, add after `live.current?.fold?.dispose();` (line ~388):

```ts
    live.current?.fold?.dispose();
    live.current?.save?.dispose();
```

- [ ] **Step 4: Centralize the base64 save toast strings (ui-strings rule)**

The response editor's `reportSave` helper still has inline toast strings. Now that `messages.response.save.*` exists (Task 6), route them through it. Add the import near the top of `BodyView.tsx` (with the other `@/lib` imports):

```ts
import { messages } from "@/lib/messages";
```

Replace the `reportSave` definition (currently around lines 331-336) with:

```ts
        const reportSave = (run: Promise<string | null>) =>
          void run
            .then((p) => {
              if (p) toast.success(messages.response.save.savedTo(p));
            })
            .catch((e) => toast.error(typeof e === "string" ? e : messages.response.save.failed));
```

- [ ] **Step 5: Forward the prop from ResponseBody**

Replace `src/features/response/ResponseBody.tsx` entirely with:

```tsx
import { BodyView } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
  /** Save the full response body to a file (context-menu action). */
  onSaveBody?: () => void;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView.
 *  Right-click a value to decode base64 or save it, Collapse/Expand all, or save
 *  the whole body to a file. */
export function ResponseBody({ json, onSaveBody }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} onSaveBody={onSaveBody} />
    </div>
  );
}
```

- [ ] **Step 6: Verify types + no test regressions**

Run: `pnpm lint && pnpm test -- BodyView ResponseBody`
Expected: `tsc -b` passes; existing BodyView/ResponseBody tests still pass. (The action wiring through Monaco is integration — covered by the `attachSaveResponseAction` unit test in Task 7 and the live checklist in Task 10.)

- [ ] **Step 7: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/response/ResponseBody.tsx
git commit -m "feat(bodyview): wire onSaveBody to the response Save action + centralize save toasts"
```

---

## Task 9: ResponsePanel header icon + Ctrl/Cmd+S + method wiring (TDD)

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx`
- Modify: `src/features/workflow/CallPanel.tsx:251` (pass `method`)
- Test: `src/features/response/ResponsePanel.test.tsx` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/features/response/ResponsePanel.test.tsx` (after the last `describe`, and add the mock near the top mocks — see note):

Add this mock alongside the existing `vi.mock` calls at the top of the file (below the `use-prefs` mock, line 12):

```ts
vi.mock("./saveResponse", () => ({ saveResponseToFile: vi.fn() }));
```

Add this import with the others (after line 15):

```ts
import { saveResponseToFile } from "./saveResponse";
```

Append this describe block at the end of the file:

```ts
describe("ResponsePanel save-to-file", () => {
  const mSave = vi.mocked(saveResponseToFile);
  beforeEach(() => mSave.mockClear());

  it("shows a Save icon on a successful response and saves on click", () => {
    render(<ResponsePanel state="success" outcome={ok} method="Search" />);
    const btn = screen.getByLabelText("Save response to file");
    fireEvent.click(btn);
    expect(mSave).toHaveBeenCalledWith(ok.response_json, "Search");
  });

  it("hides the Save icon when idle or on an error with no body", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} />);
    expect(screen.queryByLabelText("Save response to file")).toBeNull();
    rerender(<ResponsePanel state="error" outcome={err} />);
    expect(screen.queryByLabelText("Save response to file")).toBeNull();
  });

  it("Ctrl+S saves the body when one is present", () => {
    render(<ResponsePanel state="success" outcome={ok} method="Search" />);
    fireEvent.keyDown(screen.getByTestId("monaco"), { key: "s", code: "KeyS", ctrlKey: true });
    expect(mSave).toHaveBeenCalledWith(ok.response_json, "Search");
  });
});
```

Note: `beforeEach` must be imported from vitest — change the top import to `import { describe, it, expect, vi, beforeEach } from "vitest";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- ResponsePanel`
Expected: FAIL — no element with label "Save response to file" (icon not implemented yet).

- [ ] **Step 3: Implement the header icon, hotkey, and method prop**

In `src/features/response/ResponsePanel.tsx`:

(a) Update imports — add to the `react` import and add four module imports:

```ts
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { Activity, Download } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { messages } from "@/lib/messages";
import { isMacOS } from "@/lib/platform";
import { saveResponseToFile } from "./saveResponse";
import { isSaveResponseHotkey } from "./saveHotkey";
```

(b) Add `method` to the props interface (after `contract?`, line 28):

```ts
  /** Method contract for the Contract tab; omit/null → three tabs (history panels). */
  contract?: ContractInfo | null;
  /** Short method name (e.g. "GetUser") — seeds the default save filename. */
  method?: string;
```

(c) Update the destructure (line 33):

```ts
export function ResponsePanel({ state, outcome, error, contract, method }: ResponsePanelProps) {
```

(d) After the `headers` const (line 67), derive the saveable body + handlers:

```ts
  // The full pretty body, available only on a successful response. Drives the
  // header Save icon, the Ctrl/Cmd+S hotkey, and the body context-menu action.
  const body = state === "success" && outcome?.response_json != null ? outcome.response_json : null;
  const onSaveBody = () => {
    if (body !== null) void saveResponseToFile(body, method ?? "");
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (body !== null && isSaveResponseHotkey(e, isMacOS)) {
      e.preventDefault();
      onSaveBody();
    }
  };
```

(e) Add `onKeyDown` to the root div (line 70):

```tsx
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative" onKeyDown={onKeyDown}>
```

(f) Add the icon button inside the `ml-auto` cluster, before `RespMeta` (line 86-88):

```tsx
        <div className="ml-auto flex items-center gap-2.5">
          {body !== null && (
            <Tooltip content={messages.response.save.toFileTooltip} side="bottom">
              <button
                type="button"
                onClick={onSaveBody}
                aria-label={messages.response.save.toFileTooltip}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Download size={14} />
              </button>
            </Tooltip>
          )}
          <RespMeta state={state} outcome={outcome} />
        </div>
```

(g) Pass `onSaveBody` to the success-body `ResponseBody` (line 112):

```tsx
          <ResponseBody json={outcome.response_json} onSaveBody={onSaveBody} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- ResponsePanel`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Pass the method from CallPanel**

In `src/features/workflow/CallPanel.tsx`, update the `ResponsePanel` render in `ResponseSlot` (line 251):

```tsx
    <ResponsePanel state={respState} outcome={step.outcome} error={step.error} contract={contract} method={step.method} />
```

- [ ] **Step 6: Verify types + full suite**

Run: `pnpm lint && pnpm test`
Expected: `tsc -b` passes; full vitest suite green.

- [ ] **Step 7: Commit**

```bash
git add src/features/response/ResponsePanel.tsx src/features/response/ResponsePanel.test.tsx src/features/workflow/CallPanel.tsx
git commit -m "feat(response): header Save icon + Ctrl/Cmd+S + method wiring"
```

---

## Task 10: Final gate + live verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run each and confirm green:
- `cargo test --workspace`
- `pnpm test`
- `pnpm lint` (`tsc -b`)
- `pnpm build` (`tsc -b && vite build`)

- [ ] **Step 2: Confirm bindings are not drifted**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings` then `git status --porcelain src/ipc/bindings.ts`
Expected: no output (bindings already match committed state).

- [ ] **Step 3: Live WebView2 pass**

Run: `pnpm tauri:dev`, send a real unary call that returns a body, then verify:
- Right-click the response body → "Save response to file…" appears (top group, with Collapse/Expand all) → saves; toast shows "Saved to <path>".
- Header `Download` icon is visible on success → click saves.
- `Ctrl+S` (focus in the response editor) saves; the WebView "save page" dialog does NOT appear.
- The success toast's "Show in folder" button opens Explorer with the file selected.
- Default filename is `<method>-<localstamp>.json`.
- A large (elided) response saves the FULL body (open the file, confirm it's complete, not the `…` preview).
- The icon/hotkey are absent on idle and on an error response (no body).
- Cancelling the Save-As dialog shows no toast.
- (Layout sanity) The icon does not crowd `RespMeta`.

- [ ] **Step 4: Update docs on completion**

Per `.claude/rules/archiving-completed-work.md`, when merged to `main`: `git mv` the plan + spec into `archive/`, update the "Active work" section of `CLAUDE.md`, and record a memory note.

---

## Notes for the implementer

- **bindings.ts is git-tracked** and regenerated by the `export-bindings` binary (NOT by hand) — see Task 3.
- **No Rust unit test** for `file_save_text`: the native dialog needs UI. This matches `base64.rs`, whose tests only cover `inspect_impl`.
- **Why the hotkey is panel-level, not a Monaco command:** Monaco's `addCommand` registers globally and last-registration-wins across all editor instances, so binding Ctrl/Cmd+S on the response editor would clobber the request editor's Ctrl+Enter/Ctrl+R commands. The panel `onKeyDown` (bubble) is naturally scoped to focus-within and lets us `preventDefault` the WebView "save page".
- **Save the full `response_json`, never `editor.getValue()`** — the Monaco display may be elided. `onSaveBody` closes over `outcome.response_json`, so this is automatic.
