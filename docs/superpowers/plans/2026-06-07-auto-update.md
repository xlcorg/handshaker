# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postman-style auto-update for Handshaker (macOS + Windows): the app checks GitHub Releases on startup and offers a one-click signed update with relaunch.

**Architecture:** Tauri `updater` + `process` plugins provide the engine. A CI workflow builds/signs/publishes artifacts + `latest.json` to GitHub Releases on a `v*` tag. The React front-end has an isolated `src/features/updater/` slice: a `useUpdateCheck()` hook (state machine over the plugin API) and a presentational `UpdateBanner`, wired once into `WorkflowApp`.

**Tech Stack:** Tauri 2.11, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`, `tauri-apps/tauri-action@v0`, minisign update signing, React 18 + Vitest/RTL.

**Status banner:** в работе · **Дата:** 2026-06-07 · **Ветка:** `worktree-feat+auto-update` · **Спек:** [docs/superpowers/specs/2026-06-07-auto-update-design.md](../specs/2026-06-07-auto-update-design.md)

---

## Operator prerequisites (human-run, before/around CI tasks)

These are interactive or account-level steps an agent cannot fully automate. Do them when reaching Phase 3. Commands assume the worktree root and an authenticated `gh`.

- **Make repo public:** `gh repo edit xlcorg/handshaker --visibility public --accept-visibility-change-consequences`
- **Generate updater keys** (interactive password prompt): `pnpm tauri signer generate -w ~/.tauri/handshaker.key`
  - Prints a **public key** (also saved to `~/.tauri/handshaker.key.pub`) → used in Task 2.
  - Private key file `~/.tauri/handshaker.key` + its password → secrets below. **Never commit either.**
- **Set GitHub secrets:**
  - `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/handshaker.key`
  - `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (paste password when prompted; if empty password was chosen, set an empty value)

The plan's code/config tasks (1, 2, 4–8) are agent-runnable now; Task 3 (keys/secrets) and the final manual verification need the operator.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/Cargo.toml` | add `tauri-plugin-updater`, `tauri-plugin-process` deps |
| `Cargo.toml` (workspace) | pin plugin versions in `[workspace.dependencies]` |
| `src-tauri/src/lib.rs` | register both plugins on the Tauri builder |
| `src-tauri/capabilities/default.json` | grant `updater:default` + `process:allow-restart` |
| `src-tauri/tauri.conf.json` | enable bundle + `createUpdaterArtifacts`, `plugins.updater` block, drop `version` |
| `package.json` | add `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` JS deps; adjust `tauri:build` (drop `--no-bundle`) |
| `src/features/updater/useUpdateCheck.ts` | hook: state machine over plugin `check/downloadAndInstall/relaunch` |
| `src/features/updater/useUpdateCheck.test.tsx` | hook unit tests (mocked plugins) |
| `src/features/updater/UpdateBanner.tsx` | presentational banner (props-driven) |
| `src/features/updater/UpdateBanner.test.tsx` | banner unit tests |
| `src/app/WorkflowApp.tsx` | wire hook + banner once |
| `.github/workflows/release.yml` | CI: build/sign/publish on `v*` tag |

---

## Phase 1 — Front-end updater slice (TDD, agent-runnable, no Tauri runtime needed)

Done first because it is fully unit-testable in jsdom with mocked plugins, independent of the Rust/CI work.

> **Prereq (added during execution):** the JS plugin packages must be installed so the
> hook's imports resolve at build/typecheck and `vi.mock` can intercept them (same as
> the existing `Titlebar` test mocking `@tauri-apps/api/window`). Run once before Task 2:
> `pnpm add @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2`. Do NOT stub
> the modules or alias them in `vitest.config.ts`.

### Task 1: `UpdateBanner` presentational component

**Files:**
- Create: `src/features/updater/UpdateBanner.tsx`
- Test: `src/features/updater/UpdateBanner.test.tsx`

The banner is pure/props-driven (no plugin imports) so it is trivially testable. It mirrors the style of `src/features/workflow/ClientErrorBanner.tsx` (rounded, bordered, small text) but uses the neutral/accent palette, not destructive.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/updater/UpdateBanner.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";

describe("UpdateBanner", () => {
  it("shows the available version and both actions", () => {
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
  });

  it("calls onUpdate when 'Update now' is clicked", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={onUpdate} onDismiss={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /update now/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when 'Later' is clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole("button", { name: /later/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows downloading state with percent and disables the update button", () => {
    render(
      <UpdateBanner phase="downloading" version="0.2.0" progress={42} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /updating|downloading/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/updater/UpdateBanner.test.tsx`
Expected: FAIL — `Cannot find module './UpdateBanner'`.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/updater/UpdateBanner.tsx
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "error";

export interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string;
  progress: number;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Presentational Postman-style "update available" banner. Renders nothing unless
 *  an update is available or installing. Logic lives in useUpdateCheck. */
export function UpdateBanner({ phase, version, progress, onUpdate, onDismiss }: UpdateBannerProps) {
  if (phase !== "available" && phase !== "downloading") return null;
  const downloading = phase === "downloading";
  return (
    <div className="m-3 flex-none flex items-center justify-between gap-3 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs">
      <div className="text-foreground">
        {downloading ? (
          <span>Downloading update {version}… {progress}%</span>
        ) : (
          <span>A new version ({version}) is available.</span>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onUpdate}
          disabled={downloading}
          className="h-7 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-60"
        >
          {downloading ? "Updating…" : "Update now"}
        </button>
        {!downloading && (
          <button
            type="button"
            onClick={onDismiss}
            className="h-7 rounded-md px-2 text-muted-foreground hover:text-foreground"
          >
            Later
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/updater/UpdateBanner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/updater/UpdateBanner.tsx src/features/updater/UpdateBanner.test.tsx
git commit -m "feat(updater): presentational UpdateBanner component"
```

---

### Task 2: `useUpdateCheck` hook (state machine over the plugin)

**Files:**
- Create: `src/features/updater/useUpdateCheck.ts`
- Test: `src/features/updater/useUpdateCheck.test.tsx`

The hook owns all behavior. It checks once on mount; on success with an update it exposes `phase: "available"` + `version`; `install()` downloads (updating `progress`) then relaunches; `dismiss()` hides until next launch. Any thrown error (incl. running outside Tauri in the browser) is swallowed to `phase: "error"` so the app never crashes and the banner simply stays hidden.

`check()` resolves to `Update | null`. We mock `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` exactly like `Titlebar.test.tsx` mocks `@tauri-apps/api/window`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/updater/useUpdateCheck.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

import { useUpdateCheck } from "./useUpdateCheck";

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeUpdate(over: Partial<{ version: string; downloadAndInstall: (cb: (e: any) => void) => Promise<void> }> = {}) {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async () => {}),
    ...over,
  };
}

describe("useUpdateCheck", () => {
  it("starts checking, then exposes an available update", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.version).toBe("0.2.0");
  });

  it("reports upToDate when check returns null", async () => {
    check.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("upToDate"));
  });

  it("swallows a check error into the error phase (no throw)", async () => {
    check.mockRejectedValue(new Error("not running in tauri"));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("error"));
  });

  it("install() downloads (updating progress) then relaunches", async () => {
    const downloadAndInstall = vi.fn(async (cb: (e: any) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Finished" });
    });
    check.mockResolvedValue(fakeUpdate({ downloadAndInstall }));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    await act(async () => {
      await result.current.install();
    });
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("dismiss() hides the banner", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/updater/useUpdateCheck.test.tsx`
Expected: FAIL — `Cannot find module './useUpdateCheck'`.

- [ ] **Step 3: Implement the hook**

```tsx
// src/features/updater/useUpdateCheck.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdatePhase } from "./UpdateBanner";

interface UpdateState {
  phase: UpdatePhase;
  version: string;
  progress: number;
}

export interface UseUpdateCheck extends UpdateState {
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdateCheck(): UseUpdateCheck {
  const [state, setState] = useState<UpdateState>({ phase: "checking", version: "", progress: 0 });
  // Hold the Update object returned by check() so install() can act on it.
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          updateRef.current = update;
          setState({ phase: "available", version: update.version, progress: 0 });
        } else {
          setState({ phase: "upToDate", version: "", progress: 0 });
        }
      } catch {
        if (!cancelled) setState({ phase: "error", version: "", progress: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    let total = 0;
    let downloaded = 0;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        setState((s) => ({ ...s, progress: pct }));
      }
    });
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setState({ phase: "idle", version: "", progress: 0 });
  }, []);

  return { ...state, install, dismiss };
}
```

> Note: `useCallback` is imported from `react` (named `useCallback`, not `useCallBack`). If the editor autocompletes wrong, fix the import to `import { useCallback, useEffect, useRef, useState } from "react";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/updater/useUpdateCheck.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/updater/useUpdateCheck.ts src/features/updater/useUpdateCheck.test.tsx
git commit -m "feat(updater): useUpdateCheck hook (state machine over plugin)"
```

---

### Task 3: Wire the banner into `WorkflowApp`

**Files:**
- Modify: `src/app/WorkflowApp.tsx` (import + one hook call + render banner above `<SidebarProvider>`)
- Modify/Create: `src/app/WorkflowApp.test.tsx` (add one test; file already mocks `@tauri-apps`)

The banner renders just under the `Titlebar`, above the main `SidebarProvider`, so it spans the full width like other app-level banners.

- [ ] **Step 1: Add the failing wiring test**

Append to `src/app/WorkflowApp.test.tsx`. It must mock the two plugin modules so the hook's `check()` resolves to an update; assert the banner appears.

```tsx
// at top of src/app/WorkflowApp.test.tsx, alongside existing vi.mock calls:
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue({ version: "9.9.9", downloadAndInstall: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

// new test inside the existing describe block:
it("shows the update banner when an update is available", async () => {
  render(<WorkflowApp />);
  expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
});
```

> If `WorkflowApp.test.tsx` does not already import `render`/`screen`/`it`, reuse the file's existing imports and `render` helper rather than adding new ones. Match the surrounding mock style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/WorkflowApp.test.tsx`
Expected: FAIL — banner text `9.9.9` not found (banner not wired yet).

- [ ] **Step 3: Wire hook + banner into `WorkflowApp.tsx`**

Add the import near the other feature imports:

```tsx
import { useUpdateCheck } from "@/features/updater/useUpdateCheck";
import { UpdateBanner } from "@/features/updater/UpdateBanner";
```

Inside `WorkflowApp()`, near the other hooks (after `const [prefs, setPref] = usePrefs();`):

```tsx
  const update = useUpdateCheck();
```

Render the banner directly after `<Titlebar … />` and before `<SidebarProvider …>`:

```tsx
      <Titlebar onOpenSettings={() => setSettingsOpen(true)} />

      <UpdateBanner
        phase={update.phase}
        version={update.version}
        progress={update.progress}
        onUpdate={update.install}
        onDismiss={update.dismiss}
      />

      <SidebarProvider className="min-h-0 flex-1">
```

- [ ] **Step 4: Run the focused test + full suite**

Run: `pnpm vitest run src/app/WorkflowApp.test.tsx`
Expected: PASS (existing tests + the new one).

Run: `pnpm test`
Expected: all tests pass (baseline was 539; now ~549 with the new updater tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm lint`
Expected: no TypeScript errors.

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(updater): wire update banner into WorkflowApp"
```

🧹 **/clear-чекпойнт** — конец Phase 1 (фронт готов и зелёный). Свежая сессия для Phase 2.

---

## Phase 2 — Tauri plugin wiring + bundle/updater config (Rust; needs `dist/`)

> Per project rule: a fresh worktree must `pnpm install` then build `dist/` **before** compiling `src-tauri` (`generate_context!` needs `dist/`). Run `pnpm build` once at the start of this phase.

### Task 4: Add the Rust plugins and register them

**Files:**
- Modify: `Cargo.toml` (workspace `[workspace.dependencies]`)
- Modify: `src-tauri/Cargo.toml` (`[dependencies]`)
- Modify: `src-tauri/src/lib.rs` (register plugins)

- [ ] **Step 1: Pin plugin versions in the workspace `Cargo.toml`**

In the root `Cargo.toml` `[workspace.dependencies]`, near the Tauri runtime pins, add:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Reference them in `src-tauri/Cargo.toml`**

In `src-tauri/Cargo.toml` `[dependencies]`, after the `tauri = { workspace = true, … }` line, add:

```toml
tauri-plugin-updater = { workspace = true }
tauri-plugin-process = { workspace = true }
```

- [ ] **Step 3: Register both plugins on the builder**

In `src-tauri/src/lib.rs`, in `run()`, add the plugins to the `tauri::Builder::default()` chain — insert right after `.invoke_handler(specta_builder.invoke_handler())`:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 4: Build to verify it compiles**

Run (from worktree root, after `pnpm build` has produced `dist/`):
`cargo build -p handshaker`
Expected: compiles successfully (plugins resolve, builder accepts them).

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat(updater): register updater + process plugins (Rust)"
```

---

### Task 5: Grant ACL permissions

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the two permissions**

In the `permissions` array of `src-tauri/capabilities/default.json`, add:

```json
    "updater:default",
    "process:allow-restart"
```

(Append after the existing `core:*` permissions. `process:allow-restart` is the minimal grant needed for `relaunch()`; do not add `process:default`.)

- [ ] **Step 2: Build to verify the capability schema accepts them**

Run: `cargo build -p handshaker`
Expected: compiles; no "unknown permission" error from the capability validator. (If the validator rejects an identifier, the correct ones are listed by `cargo tauri permission ls tauri-plugin-updater` / `tauri-plugin-process`.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(updater): grant updater + process:allow-restart capabilities"
```

---

### Task 6: Enable bundling + updater artifacts + endpoint; single-source the version

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json` (`tauri:build` script)

The public key value comes from the operator step (`~/.tauri/handshaker.key.pub`). Until keys exist, use a clearly-marked placeholder and leave Task 6's commit for when the key is available, OR commit with the real key if Phase 3 keys were generated first. The build still compiles with any non-empty `pubkey` string; the updater only validates signatures at runtime.

- [ ] **Step 1: Edit `tauri.conf.json`**

Set `bundle.active` to `true`, add `createUpdaterArtifacts`, add the `plugins.updater` block, and **remove the top-level `"version": "0.1.0"` line** so the app version comes solely from `src-tauri/Cargo.toml` (`package.version = "0.1.0"` already matches). Result:

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Handshaker",
  "identifier": "dev.handshaker.app",
  // NOTE: no top-level "version" — Tauri reads it from src-tauri/Cargo.toml
  "build": { /* unchanged */ },
  "app": { /* unchanged */ },
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": "all",
    "icon": [ /* unchanged */ ]
  },
  "plugins": {
    "updater": {
      "pubkey": "PASTE_CONTENT_OF_~/.tauri/handshaker.key.pub",
      "endpoints": [
        "https://github.com/xlcorg/handshaker/releases/latest/download/latest.json"
      ]
    }
  }
}
```

- [ ] **Step 2: Drop `--no-bundle` from the build script**

In `package.json`, change:

```json
    "tauri:build": "tauri build --no-bundle",
```

to:

```json
    "tauri:build": "tauri build",
```

- [ ] **Step 3: Verify config validity + version resolution**

Run: `pnpm build` (ensure `dist/` fresh), then `cargo build -p handshaker`
Expected: compiles; `generate_context!` accepts the config (valid `plugins.updater` schema, no `version` is fine).

Optionally confirm the resolved version:
Run: `cargo tauri info` (look for app version `0.1.0` sourced from Cargo.toml).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json package.json
git commit -m "feat(updater): enable bundle + updater artifacts, single-source version via Cargo.toml"
```

🧹 **/clear-чекпойнт** — конец Phase 2 (app собирается с апдейтером). Phase 3 = CI + operator.

---

## Phase 3 — CI release pipeline (+ operator prerequisites)

Do the **Operator prerequisites** section now (repo public, keys, secrets), then Task 7. Paste the real public key into `tauri.conf.json` (Task 6 Step 1) if it was left as a placeholder, and amend/append a commit.

### Task 7: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

Triggered by a `v*` tag. Matrix: macOS universal + Windows. `tauri-apps/tauri-action@v0` builds, signs (minisign via the secrets), and creates a GitHub Release with artifacts + `latest.json`. macOS uses ad-hoc signing (`signingIdentity: "-"`) via env so Apple-Silicon downloads aren't flagged "damaged".

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/release.yml
name: release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: "--target universal-apple-darwin"
          - platform: windows-latest
            args: ""
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install frontend deps
        run: pnpm install

      - name: Build & release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_SIGNING_IDENTITY: "-"
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Handshaker ${{ github.ref_name }}"
          releaseBody: "See the assets to download and install."
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Lint the workflow locally (YAML sanity)**

Run: `pnpm dlx yaml-lint .github/workflows/release.yml` (or any YAML validator; a parse error here costs a full CI round-trip).
Expected: valid YAML.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build/sign/publish macOS+Windows to GitHub Releases on v* tag"
```

- [ ] **Step 4: First release dry-run (operator)**

Ensure Tasks 1–7 are committed and pushed, repo is public, secrets are set, and the real `pubkey` is in `tauri.conf.json`. Then:

```bash
git push origin worktree-feat+auto-update   # or merge to main first, per finishing-a-development-branch
git tag v0.1.0
git push origin v0.1.0
gh run watch
```

Expected: both matrix legs go green; a `v0.1.0` Release appears with macOS `.app.tar.gz` + `.dmg`, Windows `.msi`/`-setup.exe`, their `.sig` files, and `latest.json`.

---

### Task 8: End-to-end update verification (manual, operator on the MacBook)

This is the spec's manual verification step — there is no automated substitute for a real self-replacing update.

- [ ] **Step 1:** On the MacBook, download the `v0.1.0` `.dmg` from the Release, install, right-click → Open (ad-hoc signed → first-run Gatekeeper prompt).
- [ ] **Step 2:** Bump the version: in `src-tauri/Cargo.toml` set `version = "0.1.1"` (and `package.json` for tidiness). Commit.
- [ ] **Step 3:** Tag and push: `git tag v0.1.1 && git push origin v0.1.1`. Wait for the Release to publish.
- [ ] **Step 4:** Relaunch the installed `v0.1.0` app. Expected: within a few seconds the **update banner** shows "A new version (0.1.1) is available."
- [ ] **Step 5:** Click **Update now**. Expected: progress %, then the app relaunches on `0.1.1`. Confirm the version in Settings → About.

If the banner does not appear: check the app can reach `releases/latest/download/latest.json` (public repo), that the running app's `pubkey` matches the signing key, and that `0.1.1 > 0.1.0` is reflected in `latest.json`.

---

## Done / follow-ups

When Phase 3 is green and Task 8 passes, the feature is feature-complete. Per `CLAUDE.md`, archive this plan + the spec (`git mv` to `…/archive/`) in a `docs(archive): auto-update plan+spec` commit, and use `superpowers:finishing-a-development-branch` to integrate the worktree branch.

**Deferred follow-ups (out of scope, non-breaking):** Apple Developer ID signing + notarization; Windows Authenticode signing; a manual "Check for updates" button in Settings → About; changelog/release-notes rendering in the banner; periodic (timer) checks.
