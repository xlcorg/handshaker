# Plan #3 UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Monaco (bundled locally), bring Response panel to Postman-style Tabs+StatusBar layout matching master spec §8.4, add ⌘↵/Ctrl+Enter Send hotkey, document deviations via errata.

**Architecture:** Frontend-only refactor. Monaco loaded via Vite `?worker` imports + `loader.config({ monaco })` — no CDN, offline-safe. shadcn `Tabs` replaces `<details>` for trailers. StatusBar becomes a compact pill placed right of the tab strip; error message moves to a separate inline strip below the tab strip (shown only when status_code != 0). Send hotkey via `window` keydown listener inside InvokePanel.

**Tech Stack:** React 18, TypeScript 5, Vite 6 (`?worker` native), Tailwind v4, shadcn (Tabs), `monaco-editor@latest`, `@monaco-editor/react@4.7.0`, `@monaco-editor/loader` (transitive).

**Spec:** [Plan #3 UI Polish Design](../specs/2026-05-27-plan-03-ui-polish-design.md)

---

## Pre-flight

**Project state assumption:** main branch at commit `0062047` or later. Plan #3 already merged. Current frontend uses plain `<textarea>` / `<pre>` (no Monaco), and `<details>` for trailers. `src/lib/monaco.ts` exists as dead code.

**No automated tests for the UI in this codebase.** Each task ends with `pnpm lint && pnpm build` (catches type/build errors). Final manual smoke against live gRPC at `127.0.0.1:5002` verifies UX.

**Commit policy:** one commit per task. Conventional commit messages.

---

## Task 1: Install deps + shadcn tabs

**Files:**
- Modify: `C:/dev/rust/handshaker/package.json`
- Modify: `C:/dev/rust/handshaker/pnpm-lock.yaml`
- Create: `C:/dev/rust/handshaker/src/components/ui/tabs.tsx` (via shadcn add)

- [ ] **Step 1: Install monaco-editor**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm add monaco-editor
```

Expected output: `+ monaco-editor X.Y.Z` (latest stable).

- [ ] **Step 2: Add shadcn tabs component**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm dlx shadcn@latest add tabs
```

Expected: creates `src/components/ui/tabs.tsx`. Also pulls `@radix-ui/react-tabs` as a dep.

If shadcn prompts about an existing components.json or asks about overwrites — accept defaults. The file should end up with `TabsList`, `TabsTrigger`, `TabsContent`, and `Tabs` exports.

- [ ] **Step 3: Verify tabs.tsx structure**

Run:
```bash
grep -E "^export.*(Tabs|TabsList|TabsTrigger|TabsContent)" "C:/dev/rust/handshaker/src/components/ui/tabs.tsx"
```

Expected output: 4 named exports (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`). Order may vary.

- [ ] **Step 4: Verify build still works**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint && pnpm build
```

Expected: both clean, `dist/` regenerated.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/tabs.tsx components.json
git commit -m "chore(deps): add monaco-editor + shadcn tabs for UI polish

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(`components.json` may or may not change depending on shadcn version — `git add` it if `git status` shows it modified.)

---

## Task 2: Rewrite `src/lib/monaco.ts` with local bundle

**Files:**
- Modify: `C:/dev/rust/handshaker/src/lib/monaco.ts` (full rewrite)

- [ ] **Step 1: Replace `monaco.ts` content**

Overwrite `C:/dev/rust/handshaker/src/lib/monaco.ts` with exactly:

```ts
import { lazy } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import loader from "@monaco-editor/loader";

/**
 * Bundle Monaco locally — no CDN dependency. Desktop apps need to work offline.
 *
 * We register `self.MonacoEnvironment` BEFORE `loader.config({ monaco })` so the
 * Monaco instance we pass to the loader already knows how to spawn its workers
 * when consumers mount `<MonacoEditor>`. Both are synchronous top-level
 * statements — order is preserved.
 *
 * Workers we ship: editor (required) + json (request/response are JSON).
 * We deliberately skip ts/css/html/* workers — they aren't used and would
 * bloat the bundle.
 */
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

/**
 * Lazy-loaded Monaco editor. Initial app bundle stays small; the first render
 * of `<MonacoEditor>` pulls in the ~4MB Monaco core + json worker on demand.
 */
export const MonacoEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react");
  return { default: mod.default };
});

export const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "on",
} as const;

export const READ_ONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  readOnly: true,
} as const;

/**
 * Monaco theme — `vs-dark` fits the shadcn new-york OKLCH dark palette closely
 * enough for MVP. Custom theme registration is a separate sub-plan.
 */
export const MONACO_THEME = "vs-dark" as const;
```

- [ ] **Step 2: Verify `vite-env.d.ts` already has the worker types**

Check:
```bash
cat "C:/dev/rust/handshaker/src/vite-env.d.ts"
```

Expected: contains `/// <reference types="vite/client" />`. If it doesn't exist or doesn't have that line, create/modify it with:
```ts
/// <reference types="vite/client" />
```

Vite 6's `vite/client` types include `?worker` declarations — this enables TypeScript to resolve the worker imports.

- [ ] **Step 3: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean (no errors). Common failure: missing `?worker` types → fix Step 2.

- [ ] **Step 4: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean. Vite should now produce additional chunks (look for `editor.worker-*.js`, `json.worker-*.js`, and a monaco chunk). Initial bundle should remain around 217 KB.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monaco.ts src/vite-env.d.ts
git commit -m "feat(monaco): bundle Monaco locally via Vite ?worker imports

Configure self.MonacoEnvironment + loader.config({ monaco }) so the
editor loads from local chunks instead of cdn.jsdelivr.net. Ships only
editor + json workers to keep the bundle lean. Desktop app now works
offline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage `src/vite-env.d.ts` only if you modified it in Step 2.)

---

## Task 3: Restore `BodyEditor` with Monaco

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/invoke/BodyEditor.tsx` (full rewrite)

- [ ] **Step 1: Replace `BodyEditor.tsx` content**

Overwrite `C:/dev/rust/handshaker/src/features/invoke/BodyEditor.tsx` with exactly:

```tsx
import { Suspense } from "react";
import { MonacoEditor, EDITOR_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Request-body editor. Monaco JSON, bundled locally (see `src/lib/monaco.ts`).
 * Lazy-loaded — first render triggers a one-time ~4MB chunk fetch.
 */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading editor…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={EDITOR_OPTIONS}
      />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/invoke/BodyEditor.tsx
git commit -m "feat(invoke): restore Monaco BodyEditor

Reverts the textarea fallback. Monaco now bundled locally per Plan #3
UI Polish §4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Restore `BodyView` with Monaco read-only

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/response/BodyView.tsx` (full rewrite)

- [ ] **Step 1: Replace `BodyView.tsx` content**

Overwrite `C:/dev/rust/handshaker/src/features/response/BodyView.tsx` with exactly:

```tsx
import { Suspense } from "react";
import { MonacoEditor, READ_ONLY_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyViewProps {
  json: string;
}

/**
 * Read-only JSON response view. Same Monaco instance as `BodyEditor`,
 * `readOnly: true`.
 */
export function BodyView({ json }: BodyViewProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading viewer…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={json}
        options={READ_ONLY_OPTIONS}
      />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/response/BodyView.tsx
git commit -m "feat(response): restore Monaco read-only BodyView

Reverts the <pre> fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: StatusBar — compact Postman-style pill

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/response/StatusBar.tsx` (full rewrite)

- [ ] **Step 1: Replace `StatusBar.tsx` content**

Overwrite `C:/dev/rust/handshaker/src/features/response/StatusBar.tsx` with exactly:

```tsx
import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface StatusBarProps {
  outcome: InvokeOutcomeIpc;
}

/**
 * Compact status pill — `● CODE · ms · size`. Placed inline at the right end
 * of the response tab strip (Postman-style). Status message lives separately,
 * rendered by `ResponsePanel` as an inline strip below the tabs when non-OK.
 */
export function StatusBar({ outcome }: StatusBarProps) {
  const isOk = outcome.status_code === 0;
  const dotColor = isOk
    ? "bg-[oklch(0.7_0.16_145)]"
    : "bg-[oklch(0.704_0.191_22.216)]";
  const size = outcome.response_json
    ? new TextEncoder().encode(outcome.response_json).length
    : 0;
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
        aria-hidden
      />
      <span>{statusName(outcome.status_code)}</span>
      <span className="text-muted-foreground">·</span>
      <span>{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span>{formatBytes(size)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean. The old version of StatusBar likely had a wrapper `<div className="px-3 py-2 border-b ...">` and included `status_message` — both removed. ResponsePanel will need updating to position StatusBar inside the tab strip (Task 7).

- [ ] **Step 3: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/response/StatusBar.tsx
git commit -m "refactor(response): StatusBar becomes a compact inline pill

Drops the wrapper container, padding, border, and status_message — these
all move to ResponsePanel's tab-strip area (next task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: TrailersView — strip `<details>`, render plain `<dl>`

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/response/TrailersView.tsx` (full rewrite)

- [ ] **Step 1: Replace `TrailersView.tsx` content**

Overwrite `C:/dev/rust/handshaker/src/features/response/TrailersView.tsx` with exactly:

```tsx
export interface TrailersViewProps {
  trailers: Partial<{ [key: string]: string }>;
}

/**
 * Renders gRPC trailing metadata as a key/value list. The `<details>` wrapper
 * from the original implementation is gone — `TrailersView` is now the body of
 * a Tab in `ResponsePanel`.
 */
export function TrailersView({ trailers }: TrailersViewProps) {
  const entries = Object.entries(trailers ?? {});
  if (entries.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground italic">
        No trailers.
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-xs font-mono">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/response/TrailersView.tsx
git commit -m "refactor(response): TrailersView drops <details> wrapper

Will be wrapped by a Tab in ResponsePanel — collapsing UI now lives in
the tab itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ResponsePanel — Tabs + Postman status + inline error strip

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/response/ResponsePanel.tsx` (full rewrite)

- [ ] **Step 1: Replace `ResponsePanel.tsx` content**

Overwrite `C:/dev/rust/handshaker/src/features/response/ResponsePanel.tsx` with exactly:

```tsx
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBar } from "./StatusBar";
import { BodyView } from "./BodyView";
import { TrailersView } from "./TrailersView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  outcome: InvokeOutcomeIpc;
}

/**
 * Postman-style response panel:
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │ Body  Trailers (n)              ● CODE · ms · size       │  ← tab strip + status
 * ├──────────────────────────────────────────────────────────┤
 * │ ⚠ status_message (only when status_code != 0)            │  ← inline error strip
 * ├──────────────────────────────────────────────────────────┤
 * │ active tab content                                       │
 * └──────────────────────────────────────────────────────────┘
 *
 * Tab state is local and persists across new outcomes for the same selected
 * method — when the method changes upstream, `outcome` becomes null and
 * ResponsePanel unmounts, resetting the state.
 */
type TabKey = "body" | "trailers";

export function ResponsePanel({ outcome }: ResponsePanelProps) {
  const [tab, setTab] = useState<TabKey>("body");
  const trailerCount = Object.keys(outcome.trailing_metadata ?? {}).length;
  const isError = outcome.status_code !== 0;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between border-b border-border px-3">
        <TabsList className="bg-transparent p-0 h-9">
          <TabsTrigger value="body" className="text-xs">
            Body
          </TabsTrigger>
          <TabsTrigger value="trailers" className="text-xs">
            Trailers ({trailerCount})
          </TabsTrigger>
        </TabsList>
        <StatusBar outcome={outcome} />
      </div>
      {isError && outcome.status_message && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {outcome.status_message}
        </div>
      )}
      <TabsContent value="body" className="flex-1 min-h-0 m-0">
        {outcome.response_json !== null && outcome.response_json !== undefined ? (
          <BodyView json={outcome.response_json} />
        ) : (
          <div className="text-sm text-muted-foreground p-4 italic">
            No response body (status code {outcome.status_code}).
          </div>
        )}
      </TabsContent>
      <TabsContent value="trailers" className="flex-1 min-h-0 m-0 overflow-auto">
        <TrailersView trailers={outcome.trailing_metadata} />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean. If TypeScript complains about `outcome.trailing_metadata` type — it's `Partial<{ [key in string]: string }>` per bindings.ts. `Object.keys()` is fine.

- [ ] **Step 3: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/response/ResponsePanel.tsx
git commit -m "feat(response): Postman-style Tabs + StatusBar pill + error strip

Body | Trailers (n) tabs replace the previous inline body + <details>
trailers. StatusBar lives compactly right of the tab strip. Status
message renders as a separate inline strip below the tab strip, only
when status_code != 0. Brings the panel close to master spec §8.4
modulo the address-bar redesign (deferred to Plan #7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Ctrl+Enter / ⌘↵ Send hotkey in InvokePanel

**Files:**
- Modify: `C:/dev/rust/handshaker/src/features/invoke/InvokePanel.tsx`

- [ ] **Step 1: Locate the current `useEffect` block**

Read the file:
```bash
cat "C:/dev/rust/handshaker/src/features/invoke/InvokePanel.tsx"
```

Confirm it has one `useEffect` already (for skeleton autoload, dep array `[selected.service, selected.method]`).

- [ ] **Step 2: Add the hotkey `useEffect` and `aria-keyshortcuts`**

Replace the entire file with exactly:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BodyEditor } from "./BodyEditor";
import { ipc } from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface SelectedMethod {
  service: string;
  method: string;
}

export interface InvokePanelProps {
  selected: SelectedMethod;
  onOutcome: (outcome: InvokeOutcomeIpc) => void;
  onError: (message: string) => void;
}

export function InvokePanel({ selected, onOutcome, onError }: InvokePanelProps) {
  const [body, setBody] = useState<string>("{}");
  const [busy, setBusy] = useState(false);

  // When the method changes, load a skeleton. If the body is not empty and not
  // the default `{}`, ask for confirmation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const skeleton = await ipc.grpcBuildRequestSkeleton(
          selected.service,
          selected.method,
        );
        if (cancelled) return;
        const isEmpty = body.trim() === "" || body.trim() === "{}";
        if (
          isEmpty ||
          window.confirm("Replace current request body with the method's skeleton?")
        ) {
          setBody(skeleton);
        }
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "failed to load skeleton");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body intentionally not a dep
  }, [selected.service, selected.method]);

  async function handleSend() {
    // Local JSON validation — produces a better error than a backend round-trip.
    try {
      JSON.parse(body);
    } catch (e) {
      onError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }

    setBusy(true);
    try {
      const outcome = await ipc.grpcInvokeUnary({
        service: selected.service,
        method: selected.method,
        request_json: body,
        metadata: {},
      });
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
    } finally {
      setBusy(false);
    }
  }

  // ⌘↵ / Ctrl+Enter Send — master spec §9 mandate.
  // `preventDefault()` so Monaco doesn't insert a newline when the editor has
  // focus.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
        e.preventDefault();
        handleSend();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend captures body via closure; we want fresh body on each keystroke
  }, [busy, body, selected.service, selected.method]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="font-mono text-sm">
          <span className="text-muted-foreground">{selected.service}</span>
          <span className="mx-1">/</span>
          <span className="font-semibold">{selected.method}</span>
        </div>
        <Button
          onClick={handleSend}
          disabled={busy}
          size="sm"
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <BodyEditor value={body} onChange={setBody} />
      </div>
    </div>
  );
}
```

(Only changes from the current file: added the second `useEffect` for the hotkey listener; added `aria-keyshortcuts` on the Send button.)

- [ ] **Step 3: Verify lint passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 4: Verify build passes**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/invoke/InvokePanel.tsx
git commit -m "feat(invoke): Ctrl+Enter / ⌘↵ Send hotkey

window keydown listener inside InvokePanel — active only while a
method is selected. preventDefault() so Monaco doesn't insert a newline
when the editor has focus. aria-keyshortcuts on the Send button for
screen-reader discoverability.

Master spec §9 mandate that was missed in Plan #3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Errata

**Files:**
- Create: `C:/dev/rust/handshaker/docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md`

- [ ] **Step 1: Create the errata directory if missing**

Run:
```bash
mkdir -p "C:/dev/rust/handshaker/docs/superpowers/errata"
```

- [ ] **Step 2: Write the errata file**

Create `C:/dev/rust/handshaker/docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md` with exactly:

```markdown
# Errata — Plan #3 UI Polish

> Documents deviations introduced by [Plan #3 UI Polish](../specs/2026-05-27-plan-03-ui-polish-design.md) from prior specifications.

Applies to:
- [Master MVP design (2026-05-26)](../specs/2026-05-26-handshaker-mvp-design.md)
- [Plan #3 — Dynamic Unary Invoke design (2026-05-27)](../specs/2026-05-27-plan-03-dynamic-invoke-design.md)

## Deviations

| # | Document § | Original | Revised | Reason |
|---|---|---|---|---|
| 1 | Plan #3 design D6 / §9.2 (Trailers) | `<details>` collapsible | shadcn Tabs `Body \| Trailers (n)` | Brings closer to master §8.4; direct user request after UX review. |
| 2 | Plan #3 design §9.2 (Trailers 0-key) | "Не рендерим если 0 ключей" | Always render `Trailers (0)` | Layout stability — tabs should not appear/disappear with state. |
| 3 | Plan #3 design §9.3 (Monaco loading) | `lazy(() => import('@monaco-editor/react'))` with default CDN loader | Same + `loader.config({ monaco })` + Vite `?worker` imports for editor + json workers | Offline-safe for a desktop app; removes CDN dependency that's brittle in restricted webview environments. |
| 4 | Master §8.4 (StatusBar) | Above the tabs as a separate row | Postman-style: compact pill right of the tab strip | Better horizontal-space utilization; familiar to gRPC users coming from Postman / Bruno / Insomnia. |
| 5 | Plan #3 design §9.2 (status message) | Inline inside StatusBar | Separate inline strip below the tab strip, shown only when `status_code != 0` | StatusBar on the right must stay compact (limited width next to tabs). |
| 6 | Master §9 (Send hotkey) | `⌘↵ / Ctrl+Enter` | Implemented in Plan #3 UI Polish | Master mandate; missed in Plan #3 §13. |

## Status

All deviations were applied via the implementation plan
`docs/superpowers/plans/2026-05-27-plan-03-ui-polish.md` and merged in the
sub-plan's final commit. Future plans should reference this errata when
revisiting the affected sections.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md
git commit -m "docs(errata): Plan #3 UI Polish — 6 deviations from prior specs

D6 reversal (trailers tab vs <details>), Trailers(0) rendering,
Monaco local bundling, Postman-style StatusBar placement, error
message separation, Send hotkey — all documented as audit trail
for future plans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Manual smoke verification

**Files:** none (verification only)

**Pre-req:** Live gRPC service running at `127.0.0.1:5002` (the Notex backend used during Plan #3 verification).

- [ ] **Step 1: Start the Tauri dev app**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm tauri:dev
```

Wait for the Tauri window to open. Vite serves at `localhost:1420`.

- [ ] **Step 2: Connect to live service**

In the Tauri window:
1. Enter `localhost:5002` in the address input.
2. Leave plaintext mode (the lock icon should be unlocked / open).
3. Click `Connect`.

Expected: catalog populates with at least `Xellic.Notex.Presentation.Abstractions.NotesService` and `grpc.reflection.v1alpha.ServerReflection`.

- [ ] **Step 3: Verify method click + Monaco load**

Click `Create` under `NotesService`.

Expected:
- The Create row highlights with `bg-accent` background.
- Below the catalog, the InvokePanel appears with `service / method` header and Send button.
- After ~0.5–2s, the Monaco editor renders with a JSON skeleton like `{ "content": "", "userId": "" }` (depending on actual proto). Syntax highlighting visible.

If Monaco hangs on "Loading editor…" indefinitely → DevTools Console; check for `Cannot find module 'monaco-editor'` or worker errors → Task 2 issue.

- [ ] **Step 4: Verify Send button**

Click `Send`.

Expected:
- Button shows "Sending…" briefly, then "Send".
- Bottom panel shows Postman-style tab strip: `Body  Trailers (n)` on the left, `● CODE · Xms · YB` pill on the right.
- If status_code != 0 (likely INTERNAL/13 for empty body): a thin red strip appears BELOW the tab strip with the message text.
- Body tab default-active. Either Monaco r/o body (on OK) or `No response body (status code N)` italic message (on non-OK no-body responses).

- [ ] **Step 5: Verify Ctrl+Enter hotkey**

Click into the Monaco editor (focus it), edit body (e.g., type something), then press `Ctrl+Enter` (or `⌘↵` on macOS).

Expected:
- Send fires (button briefly disabled, "Sending…").
- No newline gets inserted in the editor.

- [ ] **Step 6: Verify Trailers tab**

Click the `Trailers (4)` tab (or whatever count is shown).

Expected:
- Tab content switches to a `<dl>`-grid showing key/value pairs (`content-type: application/grpc`, `date: ...`, `server: Kestrel`, etc.).
- `Trailers (0)` should be shown if there are no trailers; clicking it shows `No trailers.` italic.

- [ ] **Step 7: Verify method switch resets**

Click a different method (e.g., `ServerReflectionInfo`).

Expected:
- InvokePanel updates header to new method.
- Confirmation dialog appears if current body was non-empty / non-default.
- Response panel disappears (outcome is null again, shows `Press Send to invoke.`).
- After clicking Send on the new method: response panel reappears, default tab is `Body` again (state was reset because ResponsePanel unmounted).

- [ ] **Step 8: Offline smoke**

1. Disable network on the host machine (turn off Wi-Fi / disconnect ethernet).
2. Close the Tauri window. Re-run `pnpm tauri:dev`.
3. Click into the Monaco editor — it should still load (from local chunks, not CDN).

Expected: Monaco renders normally even with no internet. If it hangs → Task 2's `loader.config({ monaco })` didn't take effect; investigate.

Re-enable network after the test.

- [ ] **Step 9: Stop the dev server**

`Ctrl+C` in the terminal running `pnpm tauri:dev`.

---

## Task 11: Final verification

**Files:** none (verification + final commit if needed)

- [ ] **Step 1: Run Rust tests**

Run from `C:/dev/rust/handshaker/`:
```bash
cargo test --workspace
```

Expected: `50 passed; 0 failed; 1 ignored` (the ignored is `invoke_live`, that's expected).

- [ ] **Step 2: Run frontend lint + build**

Run from `C:/dev/rust/handshaker/`:
```bash
pnpm lint && pnpm build
```

Expected: clean. Look at the `dist/` output — confirm Monaco appears as separate lazy chunks (filenames like `editor.worker-*.js`, `json.worker-*.js`, and a large `monaco-*.js` chunk). The main `index-*.js` should remain around 217 KB.

- [ ] **Step 3: Review git log**

Run:
```bash
git log --oneline -15
```

Expected: 9 new commits ahead of the merge commit `7c3d0dd`:
1. `chore(deps): add monaco-editor + shadcn tabs for UI polish`
2. `feat(monaco): bundle Monaco locally via Vite ?worker imports`
3. `feat(invoke): restore Monaco BodyEditor`
4. `feat(response): restore Monaco read-only BodyView`
5. `refactor(response): StatusBar becomes a compact inline pill`
6. `refactor(response): TrailersView drops <details> wrapper`
7. `feat(response): Postman-style Tabs + StatusBar pill + error strip`
8. `feat(invoke): Ctrl+Enter / ⌘↵ Send hotkey`
9. `docs(errata): Plan #3 UI Polish — 6 deviations from prior specs`

Plus the design-spec commit `0062047` (`docs(spec): Plan #3 UI Polish ...`) that landed in main earlier.

- [ ] **Step 4: Done**

Implementation complete. Next: invoke `superpowers:finishing-a-development-branch` to merge / PR / keep.
